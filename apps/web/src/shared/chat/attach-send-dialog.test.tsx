// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ui, type ChatMessage, type MessageAttachment } from '@nodus/contracts';
import type { ComposerSubmit } from './composer-submit.js';

vi.mock('../api-client.js', () => ({
  // Дефолт — безопасный промис: путь удаления строки зовёт DELETE вложения.
  api: vi.fn(async () => ({})),
}));

import { AttachSendDialogHost } from './attach-send-dialog.js';
import { useChatDrafts, type PendingAttachment } from './chat-drafts.js';
import { useAttachSendDialog } from './dialog-stores.js';
import { registerScopeConversation } from './scope-conversations.js';
import { registerScopeSubmit } from './submit-registry.js';

/**
 * Окно отправки вложений (#144): строки из черновика; отмена гасит вложения и
 * ОСТАВЛЯЕТ текст подписи в композере (семантика черновика Telegram);
 * отправка идёт через реестр submit-функций хостов payload'ом черновика;
 * черновик чистится сабмитом (#248) — окно держит состав снапшотом до
 * исхода и закрывается по успеху; пока есть загрузки — «Отправить»
 * заблокирована.
 */

const CONV = '11111111-1111-4111-8111-111111111111';
const KEY = `conversation:${CONV}`;

const pending = (
  localId: string,
  status: 'uploading' | 'ready' | 'error' = 'ready',
): PendingAttachment => ({
  localId,
  fileName: `${localId}.csv`,
  mime: 'text/csv',
  size: 10,
  progress: status === 'ready' ? 1 : 0.4,
  status,
  attachment:
    status === 'ready'
      ? {
          id: `att-${localId}`,
          fileId: `file-${localId}`,
          name: `${localId}.csv`,
          size: 10,
          mime: 'text/csv',
          kind: 'file',
          url: null,
          thumbnailUrl: null,
          previewKind: 'file',
          pdfUrl: null,
          width: null,
          height: null,
        }
      : null,
  objectUrl: null,
});

function reset() {
  useChatDrafts.setState({ drafts: {} });
  useAttachSendDialog.setState({ scope: null, caption: '' });
}

let queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
/** Диалог тянет queries упоминаний (#239) — рендер под провайдером. */
function renderDialog() {
  return render(
    <QueryClientProvider client={queryClient}>
      <AttachSendDialogHost />
    </QueryClientProvider>,
  );
}

describe('attach-send-dialog (#144)', () => {
  beforeEach(() => {
    reset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it('отмена: вложения сняты, подпись ВОЗВРАЩАЕТСЯ черновиком в композер', () => {
    // Открытие (composer-files): текст композера переезжает в подпись окна,
    // поле чата пустое — онлайн-дублирования нет (канон Telegram).
    useChatDrafts.getState().setText(KEY, 'подпись к файлам');
    useAttachSendDialog.getState().open(KEY, 'подпись к файлам');
    useChatDrafts.getState().setText(KEY, '');
    useChatDrafts.getState().addAttachments(KEY, [pending('a', 'uploading')]);
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    const draft = useChatDrafts.getState().drafts[KEY];
    expect(draft?.attachments).toEqual([]);
    expect(draft?.text).toBe('подпись к файлам');
    expect(useAttachSendDialog.getState().scope).toBeNull();
    expect(useAttachSendDialog.getState().caption).toBe('');
  });

  it('отправка: payload черновика через реестр хостов; сабмит чистит черновик, окно доезжает до исхода и закрывается', async () => {
    const submitted = vi.fn<(payload: ComposerSubmit) => Promise<unknown>>();
    const payloads: ComposerSubmit[] = [];
    let resolveSend: (value: unknown) => void = () => undefined;
    submitted.mockImplementation(
      (payload) =>
        new Promise((resolve) => {
          payloads.push(payload);
          resolveSend = resolve;
        }),
    );
    // Обёртка useSendChatMessage чистит черновик синхронно на сабмите (#248)
    // — мок хоста повторяет контракт реального колбэка.
    const unregister = registerScopeSubmit(KEY, (payload) => {
      const promise = submitted(payload);
      useChatDrafts.getState().clear(KEY);
      return promise;
    });

    useChatDrafts.getState().addAttachments(KEY, [pending('a'), pending('b')]);
    useAttachSendDialog.getState().open(KEY, 'комментарий');
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(payloads[0]?.text).toBe('комментарий');
    expect(payloads[0]?.attachments.map((a) => a.localId)).toEqual(['a', 'b']);
    expect(payloads[0]?.edit).toBeNull();

    // Черновик чист С САБМИТА (#248), но окно ещё открыто: строки едут
    // снапшотом до исхода (кнопка нажата, состав виден).
    expect(useChatDrafts.getState().drafts[KEY]).toBeUndefined();
    expect(useAttachSendDialog.getState().scope).toBe(KEY);
    expect(screen.getByText('a.csv')).toBeTruthy();
    expect(screen.getByText('b.csv')).toBeTruthy();

    // Успех: подпись съедена сообщением — окно закрылось, в поле ничего
    // не вернулось (левловер-возврат подписи — только у отмены).
    act(() => {
      resolveSend({});
    });
    await waitFor(() => expect(useAttachSendDialog.getState().scope).toBeNull());
    expect(useChatDrafts.getState().drafts[KEY]).toBeUndefined();
    unregister();
  });

  it('ошибка отправки: окно живо, вложения восстановлены в черновик (#248)', async () => {
    let rejectSend: (reason?: unknown) => void = () => undefined;
    const unregister = registerScopeSubmit(KEY, () => {
      useChatDrafts.getState().clear(KEY); // сабмит-чистка реальной обёртки
      return new Promise((_resolve, reject) => {
        rejectSend = reject;
      });
    });

    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, 'комментарий');
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(useChatDrafts.getState().drafts[KEY]).toBeUndefined();

    // Сеть упала: onError мутации вернул вложения в черновик — строки окна
    // снова живые, подпись на месте, повтор возможен (#144/#248).
    const dto = pending('a').attachment!;
    act(() => {
      useChatDrafts.getState().restoreFailedSend(KEY, {
        wireText: 'комментарий',
        reply: null,
        urgent: false,
        attachments: [dto],
      });
      rejectSend(new Error('network down'));
    });
    await waitFor(() => {
      const draft = useChatDrafts.getState().drafts[KEY];
      expect(draft?.attachments.map((a) => a.localId)).toEqual([dto.id]);
    });
    expect(useAttachSendDialog.getState().scope).toBe(KEY);
    expect(useChatDrafts.getState().drafts[KEY]?.text).toBe('комментарий');
    expect(screen.getByText('a.csv')).toBeTruthy();
    unregister();
  });

  it('пока есть загрузки — «Отправить» заблокирована', () => {
    useChatDrafts.getState().addAttachments(KEY, [pending('a', 'uploading')]);
    useAttachSendDialog.getState().open(KEY);
    renderDialog();
    const send = screen.getByRole('button', { name: 'Отправить' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it('клавиатура как в чате: Enter отправляет, Shift+Enter — перенос', () => {
    const submitted = vi.fn<(payload: ComposerSubmit) => Promise<unknown>>(() =>
      Promise.resolve({}),
    );
    const unregister = registerScopeSubmit(KEY, (payload) => submitted(payload));
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, 'текст');
    renderDialog();

    const caption = screen.getByPlaceholderText('Добавить подпись');
    fireEvent.keyDown(caption, { key: 'Enter', shiftKey: true });
    expect(submitted).not.toHaveBeenCalled();
    fireEvent.keyDown(caption, { key: 'Enter' });
    expect(submitted).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('Ctrl+Enter в подписи — перенос строки, не отправка (#777)', async () => {
    const submitted = vi.fn<(payload: ComposerSubmit) => Promise<unknown>>(() =>
      Promise.resolve({}),
    );
    const unregister = registerScopeSubmit(KEY, (payload) => submitted(payload));
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, 'строка');
    renderDialog();

    const caption = screen.getByPlaceholderText('Добавить подпись') as HTMLTextAreaElement;
    caption.setSelectionRange(6, 6);
    fireEvent.keyDown(caption, { key: 'Enter', ctrlKey: true });

    expect(submitted).not.toHaveBeenCalled();
    expect(useAttachSendDialog.getState().caption).toBe('строка\n');
    await waitFor(() => expect(caption.selectionStart).toBe(7));
    unregister();
  });

  it('снятие последней строки крестиком: окно закрывается, подпись возвращается черновиком', async () => {
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, 'набранный текст');
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Убрать из сообщения' }));

    await waitFor(() => expect(useAttachSendDialog.getState().scope).toBeNull());
    // Автозакрытие = отмена: текст не теряется (валидатор #144).
    expect(useChatDrafts.getState().drafts[KEY]?.text).toBe('набранный текст');
    expect(useChatDrafts.getState().drafts[KEY]?.attachments).toEqual([]);
  });

  it('клик снаружи окна НЕ закрывает его и НЕ снимает вложения (#148)', () => {
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, 'набранный текст');
    renderDialog();

    // pointerdown по заднику (вне DialogContent) — dismissal подавлен.
    fireEvent.pointerDown(document.body);

    expect(useAttachSendDialog.getState().scope).toBe(KEY);
    expect(useChatDrafts.getState().drafts[KEY]?.attachments).toHaveLength(1);
    // А намеренная отмена — работает как раньше (текст — черновиком).
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(useChatDrafts.getState().drafts[KEY]?.text).toBe('набранный текст');
    expect(useAttachSendDialog.getState().scope).toBeNull();
  });

  it('заголовок считает файлы русской плюрализацией', () => {
    useChatDrafts.getState().addAttachments(KEY, [pending('a'), pending('b')]);
    useAttachSendDialog.getState().open(KEY);
    renderDialog();
    expect(screen.getByText('Выбрано: 2 файла')).toBeTruthy();
  });

  it('открытие с готовым текстом: каретка В КОНЦЕ подписи (#241)', () => {
    // Текст композера переехал в подпись при открытии — продолжать писать
    // можно сразу, без ручного переноса курсора с начала строки.
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, 'уже написанный текст сообщения');
    renderDialog();

    const caption = screen.getByPlaceholderText('Добавить подпись') as HTMLTextAreaElement;
    const len = 'уже написанный текст сообщения'.length;
    expect(caption.selectionStart).toBe(len);
    expect(caption.selectionEnd).toBe(len);
    expect(document.activeElement).toBe(caption);
  });
});

describe('attach-send-dialog — режим правки (#188)', () => {
  beforeEach(reset);
  afterEach(cleanup);

  /** Сообщение с вложениями → setEdit (сеет строки) + окно (startMessageEdit). */
  function openEdit(withAttachments = true) {
    const attachments: MessageAttachment[] = withAttachments
      ? [
          {
            id: 'att-1',
            fileId: 'file-1',
            name: 'отчёт.png',
            size: 10,
            mime: 'image/png',
            kind: 'image',
            url: null,
            thumbnailUrl: 'blob:thumb-1',
            previewKind: 'image',
            pdfUrl: null,
            width: null,
            height: null,
          },
        ]
      : [];
    const message = { id: 'm1', text: 'исходный текст', attachments } as ChatMessage;
    useChatDrafts.getState().setText(KEY, 'черновик до правки');
    useChatDrafts.getState().setEdit(KEY, message);
    useAttachSendDialog.getState().open(KEY, message.text);
    useChatDrafts.getState().setText(KEY, '');
  }

  it('заголовок «Изменение сообщения», строки сообщения с серверным превью, «Сохранить»', () => {
    openEdit();
    renderDialog();

    expect(screen.getByText('Изменение сообщения')).toBeTruthy();
    expect(screen.getByText('отчёт.png')).toBeTruthy();
    // Превью строки — кнопка просмотра с серверной миниатюрой внутри.
    expect(screen.getByRole('button', { name: 'Открыть изображение' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeTruthy();
  });

  it('снятие последней строки НЕ закрывает окно: пустой состав — легальная правка', () => {
    openEdit();
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Убрать из сообщения' }));

    expect(useAttachSendDialog.getState().scope).toBe(KEY);
    expect(useChatDrafts.getState().drafts[KEY]?.attachments).toEqual([]);
  });

  it('сохранение: payload несёт edit + editComposition + полный состав', async () => {
    const payloads: ComposerSubmit[] = [];
    let resolveSend: (value: unknown) => void = () => undefined;
    const unregister = registerScopeSubmit(
      KEY,
      (payload) =>
        new Promise((resolve) => {
          payloads.push(payload);
          resolveSend = resolve;
        }),
    );
    openEdit();
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(payloads[0]?.edit).toMatchObject({ messageId: 'm1' });
    expect(payloads[0]?.editComposition).toBe(true);
    expect(payloads[0]?.attachments.map((a) => a.localId)).toEqual(['att-1']);

    // Хост применяет правку → finishEdit чистит вложения → окно закрывается.
    act(() => {
      resolveSend({});
      useChatDrafts.getState().finishEdit(KEY);
    });
    await waitFor(() => expect(useAttachSendDialog.getState().scope).toBeNull());
    unregister();
  });

  it('отмена: сообщение не тронуто — исходные строки без DELETE на сервер, черновик восстановлен', () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchSpy);
    openEdit();
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));

    const draft = useChatDrafts.getState().drafts[KEY];
    expect(useAttachSendDialog.getState().scope).toBeNull();
    // Правка снята, текст ДО правки восстановлен, вложения чисты.
    expect(draft?.edit ?? null).toBeNull();
    expect(draft?.text).toBe('черновик до правки');
    expect(draft?.attachments ?? []).toEqual([]);
    // Строки правимого сообщения серверу не отдавались (состав жив на сервере).
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('переименование: поле правит только базу — расширение суффиксом (вердикт 04.10)', async () => {
    openEdit();
    renderDialog();

    // Radix-меню открывается pointerdown (не click) — так же в jsdom.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Действия с вложением' }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать файл' }));

    const nameInput = await screen.findByLabelText('Имя файла');
    // Поле — только база имени; расширение — защищённый суффикс за полем.
    expect((nameInput as HTMLInputElement).value).toBe('отчёт');
    expect(screen.getByText('.png')).toBeTruthy();

    fireEvent.change(nameInput, { target: { value: 'переименованное-проба' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    await waitFor(() =>
      expect(useChatDrafts.getState().drafts[KEY]?.attachments[0]?.fileName).toBe(
        'переименованное-проба.png',
      ),
    );
  });

  it('переименование: Esc откатывает базу, окно живо', async () => {
    openEdit();
    renderDialog();

    // Radix-меню открывается pointerdown (не click) — так же в jsdom.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Действия с вложением' }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Переименовать файл' }));
    const nameInput = await screen.findByLabelText('Имя файла');
    fireEvent.change(nameInput, { target: { value: 'сломанное' } });
    fireEvent.keyDown(nameInput, { key: 'Escape' });

    // Esc погасил только правку имени — окно не закрылось, имя не тронуто.
    expect(useAttachSendDialog.getState().scope).toBe(KEY);
    expect(useChatDrafts.getState().drafts[KEY]?.attachments[0]?.fileName).toBe('отчёт.png');
  });

  it('Ctrl+V в подписи добавляет вложение, не отправляя сообщение', async () => {
    const pasteFile = new File(['x'], 'вставка.png', { type: 'image/png' });
    const submitted = vi.fn<(payload: ComposerSubmit) => Promise<unknown>>(() =>
      Promise.resolve({}),
    );
    const unregister = registerScopeSubmit(KEY, (payload) => submitted(payload));
    openEdit();
    renderDialog();

    const caption = screen.getByPlaceholderText('Добавить подпись');
    fireEvent.paste(caption, { clipboardData: { files: [pasteFile] } });

    // Строка встала в список окна (загрузка стартовала), окно живо,
    // никакого submit не было — вставка ≠ отправка (#188).
    await waitFor(() => expect(useChatDrafts.getState().drafts[KEY]?.attachments).toHaveLength(2));
    expect(useAttachSendDialog.getState().scope).toBe(KEY);
    expect(submitted).not.toHaveBeenCalled();
    unregister();
  });
});

describe('attach-send-dialog: @упоминания подписи (#239)', () => {
  const ALICE_ID = '33333333-3333-4333-8333-333333333333';
  // Тип мока — по форме ответа (generic api<T> mockImplementation не выразит).
  let apiMock: Mock<(url: unknown) => Promise<unknown>>;

  beforeEach(async () => {
    reset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    registerScopeConversation(KEY, CONV);
    const { api } = await import('../api-client.js');
    apiMock = vi.mocked(api) as unknown as typeof apiMock;
    apiMock.mockImplementation((url) => {
      // Состав беседы: Алиса-участник (автокомплит без дебаунса поиска).
      if (String(url).includes('/members')) {
        return Promise.resolve({
          items: [
            { user: { id: ALICE_ID, displayName: 'Алиса Тест', avatarUrl: null }, role: 'member' },
          ],
          nextCursor: null,
        });
      }
      return Promise.resolve({ items: [], nextCursor: null });
    });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    registerScopeConversation(KEY, undefined);
    apiMock.mockReset();
  });

  it('подпись с токенами открывается ВИДИМЫМ текстом; отправка уносит wire', async () => {
    const wire = `Привет @[Алиса Тест](user:${ALICE_ID})`;
    const payloads: ComposerSubmit[] = [];
    const unregister = registerScopeSubmit(KEY, (payload) => {
      payloads.push(payload);
      return Promise.resolve({});
    });
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, wire);
    renderDialog();

    const field = screen.getByPlaceholderText(ui.chat.attachCaption) as HTMLTextAreaElement;
    // Display-текст, не сырая разметка (#239: раньше поле показывало токен).
    expect(field.value).toBe('Привет Алиса Тест');

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(payloads[0]?.text).toBe(wire));
    unregister();
  });

  it('«@» открывает панель; выбор вставляет чип; отправка несёт токен', async () => {
    const payloads: ComposerSubmit[] = [];
    const unregister = registerScopeSubmit(KEY, (payload) => {
      payloads.push(payload);
      return Promise.resolve({});
    });
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, '');
    renderDialog();

    const field = screen.getByPlaceholderText(ui.chat.attachCaption) as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: '@' } });

    // Первый кандидат — закреплённое «Все»; выбираем Алису.
    const aliceOption = (await screen.findByText('Алиса Тест')).closest('[role="option"]')!;
    fireEvent.mouseDown(aliceOption); // каретка остаётся в поле (канон панели)

    await waitFor(() => expect(field.value).toBe('Алиса Тест '));
    expect(field.value).not.toContain('@[');

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(payloads[0]?.text).toBe(`@[Алиса Тест](user:${ALICE_ID})`));
    unregister();
  });
});

describe('attach-send-dialog — цитата ответа над списком файлов (#288)', () => {
  beforeEach(() => {
    reset();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  const original: ChatMessage = {
    id: '22222222-2222-4222-8222-222222222222',
    conversationId: CONV,
    seq: 1,
    clientMessageId: 'client-1',
    author: { id: 'u2', displayName: 'Мария Соколова', avatarUrl: null },
    text: 'Вай фая нет',
    replyToId: null,
    reply: null,
    deletedAt: null,
    pinned: false,
    forwardedFrom: null,
    threadRootId: null,
    threadRepliesCount: 0,
    reactions: [],
    attachments: [],
    editedAt: null,
    readAt: null,
    readBy: [],
    urgent: false,
    mentionedUserIds: [],
    linkPreview: null,
    createdAt: '2026-10-14T09:00:00Z',
  };

  it('плашка ответа: цитата НАД списком; крестик снимает ответ, окно живо', () => {
    useChatDrafts.getState().setReply(KEY, original, null);
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, '');
    renderDialog();

    expect(screen.getByText('Мария Соколова')).toBeTruthy();
    expect(screen.getByText('Вай фая нет')).toBeTruthy();
    // Порядок Telegram: цитата раньше строки файла в DOM
    expect(
      screen.getByText('Мария Соколова').compareDocumentPosition(screen.getByText('a.csv')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // «Отмена» две — крестик плашки и кнопка футера; крестик плашки первый в DOM
    const [bannerX] = screen.getAllByRole('button', { name: 'Отмена' });
    fireEvent.click(bannerX!);

    expect(useChatDrafts.getState().drafts[KEY]?.reply).toBeNull();
    // Окно живо: файл цел, отправка уйдёт без ответа
    expect(useAttachSendDialog.getState().scope).toBe(KEY);
    expect(screen.getByText('a.csv')).toBeTruthy();
  });

  it('отправка несёт ответ; плашка живёт на полёте (черновик чист сабмитом)', async () => {
    const payloads: ComposerSubmit[] = [];
    let resolveSend: (value: unknown) => void = () => undefined;
    const unregister = registerScopeSubmit(KEY, (payload) => {
      payloads.push(payload);
      useChatDrafts.getState().clear(KEY); // контракт хоста: чистка на сабмите
      return new Promise((resolve) => {
        resolveSend = resolve;
      });
    });

    useChatDrafts.getState().setReply(KEY, original, null);
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, '');
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(payloads[0]?.reply?.messageId).toBe(original.id);
    // Черновик чист, но цитата и файл держатся снапшотами до исхода (#248/#288)
    expect(useChatDrafts.getState().drafts[KEY]).toBeUndefined();
    expect(screen.getByText('Мария Соколова')).toBeTruthy();

    act(() => {
      resolveSend({});
    });
    await waitFor(() => expect(useAttachSendDialog.getState().scope).toBeNull());
    unregister();
  });

  it('правка: плашки ответа нет — режимы взаимоисключающие', () => {
    useChatDrafts.getState().setReply(KEY, original, null);
    useChatDrafts.getState().setEdit(KEY, original); // гасит reply в черновике
    useChatDrafts.getState().addAttachments(KEY, [pending('a')]);
    useAttachSendDialog.getState().open(KEY, 'исходный текст');
    renderDialog();

    expect(screen.queryByText('Мария Соколова')).toBeNull();
    expect(screen.getByText('Изменение сообщения')).toBeTruthy();
  });
});

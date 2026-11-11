// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { useUiPrefsStore } from './ui-prefs-store.js';
import { useAuthStore } from '../auth-store.js';
import { useViewStore } from '../views/view-store.js';

/**
 * Сторы персонализации (аудит #45): скоупы applyNav/resetPersonal и
 * КРИТИЧНЫЙ урок — applyOrder НЕ насилует видимость (скрытые по умолчанию
 * поля воскресали на первом drag колонки, 15.09.2026). Плюс zod-валидация
 * rehydrate: битая форма сохранённого — молчаливый дефолт, не белый экран.
 */
const USER_A = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'a@nodus',
  displayName: 'A',
  permissions: [],
};
const USER_B = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'b@nodus',
  displayName: 'B',
  permissions: [],
};

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ status: 'anonymous', accessToken: null, user: null });
  useUiPrefsStore.setState({ personal: {}, company: {} });
  useViewStore.setState({ views: {}, sorts: {} });
});

describe('ui-prefs-store: скоупы навигации', () => {
  it('applyNav без forAll пишет ЛИЧНЫЙ скоуп, общий не трогает', () => {
    useUiPrefsStore.getState().applyNav(['tasks', 'home'], ['chat'], false);
    const s = useUiPrefsStore.getState();
    expect(s.personal.navOrder).toEqual(['tasks', 'home']);
    expect(s.personal.navHidden).toEqual(['chat']);
    expect(s.company.navOrder).toBeUndefined();
  });

  it('applyNav с forAll («Применить для всех», админ) пишет ОБЩИЙ скоуп', () => {
    useUiPrefsStore.getState().applyNav(['chat', 'home'], [], true);
    const s = useUiPrefsStore.getState();
    expect(s.company.navOrder).toEqual(['chat', 'home']);
    expect(s.personal.navOrder).toBeUndefined();
  });

  it('resetPersonal сбрасывает только личный слой (общий остаётся)', () => {
    useUiPrefsStore.getState().applyNav(['tasks'], [], true);
    useUiPrefsStore.getState().applyNav(['home'], ['letters'], false);
    useUiPrefsStore.getState().resetPersonal();
    const s = useUiPrefsStore.getState();
    expect(s.personal).toEqual({});
    expect(s.company.navOrder).toEqual(['tasks']);
  });

  it('rehydrate: валидная форма восстанавливается', async () => {
    localStorage.setItem(
      'nodus-ui-prefs-v1:anonymous',
      JSON.stringify({ state: { personal: { navOrder: ['chat'] }, company: {} }, version: 1 }),
    );
    await useUiPrefsStore.persist.rehydrate();
    expect(useUiPrefsStore.getState().personal.navOrder).toEqual(['chat']);
  });

  it('rehydrate: БИТАЯ ФОРМА (navOrder строкой — краш аудита #45) → дефолт скоупа, соседний цел', async () => {
    localStorage.setItem(
      'nodus-ui-prefs-v1:anonymous',
      JSON.stringify({
        state: { personal: { navOrder: 'строка вместо массива' }, company: { navOrder: ['home'] } },
        version: 1,
      }),
    );
    await useUiPrefsStore.persist.rehydrate();
    const s = useUiPrefsStore.getState();
    // Сломанный личный скоуп отброшен на {}, общий выжил.
    expect(s.personal).toEqual({});
    expect(s.company.navOrder).toEqual(['home']);
  });

  it('rehydrate: не-объект целиком → дефолт', async () => {
    localStorage.setItem(
      'nodus-ui-prefs-v1:anonymous',
      JSON.stringify({ state: 'бито', version: 1 }),
    );
    await useUiPrefsStore.persist.rehydrate();
    expect(useUiPrefsStore.getState().personal).toEqual({});
  });
});

describe('view-store: порядок колонок и видимость', () => {
  it('applyOrder сохраняет ТЕКУЩУЮ видимость из entries (урок воскресающих скрытых полей)', () => {
    // Поле hidden-by-default: в пресете visible:false; drag-коммит несёт его
    // с visible:false — после applyOrder оно ОБЯЗАНО остаться скрытым.
    useViewStore.getState().setFieldVisible('tasks.list', 'creator', false);
    useViewStore.getState().applyOrder('tasks.list', [
      { id: 'title', visible: true },
      { id: 'creator', visible: false },
    ]);
    expect(useViewStore.getState().views['tasks.list']?.['creator']?.visible).toBe(false);
    expect(useViewStore.getState().views['tasks.list']?.['title']?.visible).toBe(true);
  });

  it('applyOrder пишет order по позиции, ширину не затирает', () => {
    useViewStore.getState().setFieldWidth('tasks.list', 'title', 460);
    useViewStore.getState().applyOrder('tasks.list', [
      { id: 'number', visible: true },
      { id: 'title', visible: true },
    ]);
    const prefs = useViewStore.getState().views['tasks.list'];
    expect(prefs?.['number']?.order).toBe(0);
    expect(prefs?.['title']?.order).toBe(1);
    expect(prefs?.['title']?.width).toBe(460);
  });

  it('resetView чистит и views, и sorts вида', () => {
    useViewStore.getState().setFieldVisible('tasks.list', 'creator', false);
    useViewStore.getState().setSort('tasks.list', { field: 'title', dir: 'asc' });
    useViewStore.getState().resetView('tasks.list');
    const s = useViewStore.getState();
    expect(s.views['tasks.list']).toBeUndefined();
    expect(s.sorts['tasks.list']).toBeUndefined();
  });

  it('rehydrate: битый вид отбрасывается, соседний выживает', async () => {
    localStorage.setItem(
      'nodus-views-v2',
      JSON.stringify({
        state: {
          views: {
            'tasks.list': 'бито',
            'letters.journal': { title: { visible: true, order: 0 } },
          },
          sorts: {},
        },
        version: 1,
      }),
    );
    await useViewStore.persist.rehydrate();
    const s = useViewStore.getState();
    expect(s.views['tasks.list']).toEqual({});
    expect(s.views['letters.journal']?.['title']?.order).toBe(0);
  });
});

describe('ui-prefs-store: личные области вкладок и ключ пользователя', () => {
  it('setCardTabs пишет cardTabs в личный слой', () => {
    useUiPrefsStore.getState().setCardTabs('project', {
      version: 1,
      groups: [{ tabs: ['structure', 'about'], active: 'about' }],
    });
    expect(useUiPrefsStore.getState().personal.cardTabs?.project?.groups[0]?.tabs).toEqual([
      'structure',
      'about',
    ]);
  });

  it('localStorage-ключ на пользователя: A и B не смешиваются', async () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 't', user: USER_A as never });
    useUiPrefsStore.getState().setCardTabs('task', {
      version: 1,
      groups: [{ tabs: ['chat', 'files'] }],
    });
    expect(localStorage.getItem(`nodus-ui-prefs-v1:${USER_A.id}`)).not.toBeNull();

    useAuthStore.setState({ user: USER_B as never });
    await useUiPrefsStore.persist.rehydrate();
    expect(useUiPrefsStore.getState().personal.cardTabs).toBeUndefined();

    useAuthStore.setState({ user: USER_A as never });
    await useUiPrefsStore.persist.rehydrate();
    expect(useUiPrefsStore.getState().personal.cardTabs?.task?.groups[0]?.tabs).toEqual([
      'chat',
      'files',
    ]);
  });
});

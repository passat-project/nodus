import { Injectable } from '@nestjs/common';
import type {
  AuthUser,
  LetterRelationKind,
  LetterTreeNode,
  LetterTreeResponse,
  TaskSystemState,
} from '@nodus/contracts';

import { canViewLetter } from '../access/letter-access.js';
import { LetterRelationsRepository } from './letter-relations.repository.js';
import { LettersQueryService } from './letters-query.service.js';
import { LettersRepository } from './letters.repository.js';

/** Капы дерева (#461, Р2, ред. 05.11.2026): глубина считается по ВЕТВЛЕНИЮ,
 *  а не по длине переписки — линейный ответ продолжает цепочку на том же
 *  уровне (модель «цепочка + ветки»: Gmail/Outlook-flat, mixed-model
 *  Venolia & Neustaedter). Иначе переписка в 100 писем упиралась бы в кап.
 *  8 уровней — это 8 вложенных матрёшек/веток; узлов — 200; обрезка →
 *  truncated. */
const MAX_DEPTH = 8;
const MAX_NODES = 200;
const MAX_UP = 64;

/** Строка письма в объёме узла дерева. */
type NodeRow = Awaited<ReturnType<LettersRepository['nodesByIds']>>[number];

/** Узел дерева из строки письма (у корня связи с родителем нет). */
function toNode(row: NodeRow, link: { id: string; kind: string } | null): LetterTreeNode {
  return {
    id: row.id,
    regNumber: row.regNumber,
    theirNumber: row.theirNumber,
    subject: row.subject,
    direction: row.direction as LetterTreeNode['direction'],
    systemState: row.systemState as TaskSystemState,
    confidential: row.confidential,
    relationId: link?.id ?? null,
    relationKind: (link?.kind as LetterRelationKind | undefined) ?? null,
    children: [],
  };
}

/**
 * Дерево «ёлочки» (#461, Р2): вверх по родителям до корня цепочки, вниз DFS
 * по детям обоих видов (ответы + вложенные письма). Узел — письмо, файлы в
 * дерево не входят (спека). Невидимые зрителю дочерние узлы исключаются
 * молча; невидимый промежуточный узел скрывает своё поддерево целиком
 * (подъём детей выдал бы структуру). Корень — невидимое письмо → 404.
 */
@Injectable()
export class LettersTreeService {
  constructor(
    private readonly repo: LettersRepository,
    private readonly relations: LetterRelationsRepository,
    private readonly query: LettersQueryService,
  ) {}

  async tree(user: AuthUser, letterId: string): Promise<LetterTreeResponse> {
    const requested = await this.query.visibleRow(user, letterId);
    const rootId = await this.rootOf(user, requested.id);
    const rootRow = (await this.repo.nodesByIds([rootId]))[0]!;
    const root = toNode(rootRow, null);
    const state = { nodes: 0, truncated: false };
    root.children = await this.childrenOf(user, rootRow, 0, state);
    return { root, truncated: state.truncated };
  }

  /** Верх цепочки: подъём по родителям (конверт приоритетнее ответа) до
   *  корня. Родитель выбранного вида невидим — пробуем родителя второго вида
   *  (у письма бывает и конверт, и «ответ на»): цепочку, которую зритель
   *  видеть может, терять нельзя. Ни один родитель не виден — обрыв. */
  private async rootOf(user: AuthUser, letterId: string): Promise<string> {
    let current = letterId;
    for (let step = 0; step < MAX_UP; step += 1) {
      const links = await this.relations.parentLinks([current]);
      if (links.length === 0) return current;
      const ordered = [
        ...links.filter((item) => item.kind === 'nested_in'),
        ...links.filter((item) => item.kind === 'reply_to'),
      ];
      const visible = await this.visibleRows(
        user,
        ordered.map((item) => item.relatedLetterId),
      );
      const link = ordered.find((item) => visible.has(item.relatedLetterId));
      if (!link) return current;
      current = link.relatedLetterId;
    }
    return current;
  }

  /** Дети узла (видимые, порядок: вложенные, затем ответы) с рекурсией DFS.
   *  Уровень растёт только на ВЕТВЛЕНИИ: единственный ответ продолжает
   *  цепочку на том же уровне (плоский ствол), два и больше ответов —
   *  ветка; «вложено в» — всегда уровень внутрь (матрёшка). */
  private async childrenOf(
    user: AuthUser,
    parent: NodeRow,
    depth: number,
    state: { nodes: number; truncated: boolean },
  ): Promise<LetterTreeNode[]> {
    if (depth >= MAX_DEPTH) {
      if ((await this.relations.childLinks([parent.id])).length > 0) state.truncated = true;
      return [];
    }
    const links = await this.relations.childLinks([parent.id]);
    if (links.length === 0) return [];
    const visible = await this.visibleRows(
      user,
      links.map((link) => link.letterId),
    );
    // Ветвление считаем по ВИДИМЫМ зрителю ответам: два ответа, один из
    // которых скрыт конфиденциальностью, — для него это цепочка.
    const replies = links.filter((link) => link.kind === 'reply_to' && visible.has(link.letterId));
    const rows = new Map(
      (await this.repo.nodesByIds([...visible])).map((row) => [row.id, row] as const),
    );
    const kindOrder = (kind: string) => (kind === 'nested_in' ? 0 : 1);
    const children: LetterTreeNode[] = [];
    for (const link of links.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind))) {
      if (!visible.has(link.letterId)) continue;
      const row = rows.get(link.letterId);
      if (!row) continue;
      state.nodes += 1;
      if (state.nodes > MAX_NODES) {
        state.truncated = true;
        break;
      }
      const node = toNode(row, link);
      // Единственный ответ — ствол цепочки (тот же уровень), иначе — ветка.
      const chain = link.kind === 'reply_to' && replies.length === 1;
      node.children = await this.childrenOf(user, row, chain ? depth : depth + 1, state);
      children.push(node);
    }
    return children;
  }

  /** Множество писем, видимых зрителю (конфиденциальные — по участникам). */
  private async visibleRows(user: AuthUser, ids: readonly string[]): Promise<Set<string>> {
    const rows = await this.repo.nodesByIds(ids);
    const confidentialIds = rows.filter((row) => row.confidential).map((row) => row.id);
    const participants = await this.repo.participantsOf(confidentialIds);
    const visible = new Set<string>();
    for (const row of rows) {
      if (row.deletedAt !== null) continue;
      const members = new Set(
        participants
          .filter((participant) => participant.letterId === row.id)
          .map((participant) => participant.userId),
      );
      if (canViewLetter(user, row, members)) visible.add(row.id);
    }
    return visible;
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { ReportRepo, type ReportDoc } from '../moderation/report.repo';
import { AuditService } from './audit.service';
import type { AuthUser } from '../auth/auth.types';

const toRow = (d: ReportDoc) => ({
  id: d._id.toHexString(),
  kind: d.kind,
  status: d.status,
  category: d.category,
  reporterId: d.reporterId,
  reporterName: d.reporterName,
  ...(d.message ? { message: d.message } : {}),
  ...(d.reportedUserId ? { reportedUserId: d.reportedUserId } : {}),
  ...(d.reportedName ? { reportedName: d.reportedName } : {}),
  ...(d.gameId ? { gameId: d.gameId } : {}),
  ...(d.roomCode ? { roomCode: d.roomCode } : {}),
  ...(d.mapId ? { mapId: d.mapId } : {}),
  ...(d.shareCode ? { shareCode: d.shareCode } : {}),
  ...(d.mapNameZh ? { mapNameZh: d.mapNameZh } : {}),
  ...(d.mapNameEn ? { mapNameEn: d.mapNameEn } : {}),
  ...(d.resolvedByName ? { resolvedByName: d.resolvedByName } : {}),
  ...(d.resolutionNote ? { resolutionNote: d.resolutionNote } : {}),
  ...(d.resolvedAt ? { resolvedAt: d.resolvedAt.toISOString() } : {}),
  createdAt: d.createdAt.toISOString(),
});

@Injectable()
export class DashboardReportsService {
  constructor(
    private readonly reports: ReportRepo,
    private readonly audit: AuditService,
  ) {}

  async list(query: { status: 'open' | 'resolved' | 'all'; limit: number; cursor?: string }) {
    // Fetch one extra row to learn whether a next page exists (audit-list idiom).
    const docs = await this.reports.list(query.status, query.limit + 1, query.cursor);
    const page = docs.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor = docs.length > query.limit && last ? last._id.toHexString() : null;
    return { reports: page.map(toRow), nextCursor };
  }

  async resolve(actor: AuthUser, id: string, note?: string) {
    const doc = await this.reports.resolve(id, actor.userId, actor.displayName, note);
    if (!doc) throw new NotFoundException('report not found or already resolved');
    await this.audit.log(
      actor,
      'report.resolve',
      { type: 'report', id },
      { kind: doc.kind, category: doc.category, ...(note ? { note } : {}) },
    );
    return toRow(doc);
  }
}

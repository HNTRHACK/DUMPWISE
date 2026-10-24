import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service.js';
import { OrganizationAccessService, type OrganizationAccess } from '../auth/organization-access.service.js';
import type { Env } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { TenantDb } from '../prisma/tenant-db.service.js';
import { parseBillingFile } from './parsing/parse-billing-file.js';
import { BILLING_RULES_VERSION, explainMapping, templateMappingSchema } from './parsing/template-mapping.js';
import type { CreateTemplateDto } from './import-templates.dto.js';

@Injectable()
export class ImportTemplatesService {
  constructor(
    private readonly db: TenantDb,
    private readonly access: OrganizationAccessService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(ctx: OrganizationAccess, input: CreateTemplateDto) {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    const parsed = templateMappingSchema.safeParse(input.mapping);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    try {
      return await this.db.run(ctx, async (tx) => {
        const row = await tx.importTemplateVersion.create({ data: {
          organizationId: ctx.organizationId, name: input.name.trim(), description: input.description.trim(),
          version: input.version, mapping: parsed.data, createdByUserId: ctx.userId,
        } });
        await this.audit.record({ organizationId: ctx.organizationId, actorUserId: ctx.userId,
          action: 'IMPORT_TEMPLATE_CREATED', entityType: 'ImportTemplateVersion', entityId: row.id,
          metadata: { version: row.version, rulesVersion: BILLING_RULES_VERSION } }, tx);
        return row;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('That template name/version already exists');
      throw e;
    }
  }

  async list(ctx: OrganizationAccess, limit: number, offset: number) {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    return this.db.run(ctx, async (tx) => ({
      items: await tx.importTemplateVersion.findMany({ where: { organizationId: ctx.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: limit, skip: offset }),
      total: await tx.importTemplateVersion.count({ where: { organizationId: ctx.organizationId } }), limit, offset,
    }));
  }

  async get(ctx: OrganizationAccess, id: string, approvedOnly = false) {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER', 'ANALYST']);
    const row = await this.db.run(ctx, (tx) => tx.importTemplateVersion.findFirst({
      where: { organizationId: ctx.organizationId, id, ...(approvedOnly ? { status: 'APPROVED' } : {}) },
    }));
    if (!row) throw new NotFoundException('Template version not found or not approved');
    const mapping = templateMappingSchema.parse(row.mapping);
    return { ...row, mapping, explanation: explainMapping(mapping) };
  }

  async approve(ctx: OrganizationAccess, id: string) {
    await this.access.require(ctx.userId, ctx.organizationId, ['OWNER']);
    return this.db.run(ctx, async (tx) => {
      const row = await tx.importTemplateVersion.findFirst({ where: { organizationId: ctx.organizationId, id } });
      if (!row) throw new NotFoundException('Template version not found');
      if (row.status === 'APPROVED') return row;
      // Serialize concurrent approval; updateMany's status predicate makes retries idempotent.
      await tx.importTemplateVersion.updateMany({ where: { organizationId: ctx.organizationId, id, status: 'DRAFT' },
        data: { status: 'APPROVED', approvedAt: new Date(), approvedByUserId: ctx.userId } });
      await this.audit.record({ organizationId: ctx.organizationId, actorUserId: ctx.userId,
        action: 'IMPORT_TEMPLATE_APPROVED', entityType: 'ImportTemplateVersion', entityId: id,
        metadata: { version: row.version, rulesVersion: BILLING_RULES_VERSION } }, tx);
      return tx.importTemplateVersion.findUniqueOrThrow({ where: { id } });
    });
  }

  async preview(ctx: OrganizationAccess, id: string, content: Buffer) {
    const template = await this.get(ctx, id);
    const parsed = parseBillingFile(content, {
      maxBytes: this.config.get('IMPORT_MAX_BYTES', { infer: true }),
      maxRows: this.config.get('IMPORT_MAX_ROWS', { infer: true }),
    }, template.mapping.numberFormat, template.mapping);
    // No batch, master, fact, file or audit write. Preview is not independent reconciliation.
    return {
      templateVersionId: id, rulesVersion: template.rulesVersion, status: template.status,
      mapping: template.explanation, ok: parsed.ok && parsed.stats.rowsInvalid === 0,
      stats: parsed.stats, issues: parsed.issues.slice(0, 500), issuesTruncated: parsed.issues.length > 500,
      sample: parsed.rows.slice(0, 10).map(({ contentHash: _hash, ...row }) => row),
      reconciliationStatus: 'NOT_RUN',
      limitations: ['Preview checks file content only; database duplicates and independent controls are checked during import.'],
    };
  }
}

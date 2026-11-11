import { type ArgumentMetadata, BadRequestException, Injectable, NotFoundException, type PipeTransform } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Path parameters that name a record (`:id`, `:visitId`, `:chargeId`...): every record id is a UUID. */
const ID_PARAM = /^(id|[a-z][A-Za-z]*Id)$/;
const MAX_QUERY = 500;

/**
 * Runs before every route's own validation (bodies have their Zod schemas):
 *  - a record id in the path must be a UUID, or the record is simply not found (404), so nothing
 *    malformed reaches a query;
 *  - a named query parameter must be one piece of text (`?q=a&q=b` would arrive as a list, which a
 *    query would fail on) and not unreasonably long.
 */
@Injectable()
export class RequestShapePipe implements PipeTransform {
  transform(value: unknown, meta: ArgumentMetadata) {
    if (meta.type === 'param' && meta.data) {
      if (ID_PARAM.test(meta.data) && (typeof value !== 'string' || !UUID.test(value))) throw new NotFoundException();
      if (typeof value === 'string' && value.length > 200) throw new NotFoundException();
    }
    if (meta.type === 'query' && meta.data && value !== undefined) {
      if (typeof value !== 'string') throw new BadRequestException(`The "${meta.data}" parameter must be given once, as text`);
      if (value.length > MAX_QUERY) throw new BadRequestException(`The "${meta.data}" parameter is too long`);
    }
    // A route that validates the whole query with its schema: no value may be unreasonably long.
    if (meta.type === 'query' && !meta.data && value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const parts = Array.isArray(v) ? v : [v];
        if (parts.length > 50 || parts.some((p) => typeof p === 'string' && p.length > MAX_QUERY)) {
          throw new BadRequestException(`The "${key}" parameter is too long`);
        }
      }
    }
    return value;
  }
}

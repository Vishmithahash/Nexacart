import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';
import { QaFixtureContext } from './qa-fixture-context.type';

@Injectable()
export class QaTemplateResolverService {
  /**
   * Resolve `{{path.to.value}}` placeholders in a template string using fixtureContext.
   */
  resolveString(template: string, context: QaFixtureContext): string {
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
      const val = this.getValueByPath(context, path);
      if (val === undefined || val === null) {
        throw ApiException.qaTemplateVariableNotFound(path);
      }
      return String(val);
    });
  }

  /**
   * Recursively resolve placeholders in JSON structures (strings, numbers, objects, arrays).
   */
  resolveJson(data: unknown, context: QaFixtureContext): unknown {
    if (typeof data === 'string') {
      // Direct exact match check e.g. "{{products.targetProduct.id}}" -> return actual typed value
      const exactMatch = data.match(/^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/);
      if (exactMatch && exactMatch[1]) {
        const val = this.getValueByPath(context, exactMatch[1]);
        if (val === undefined) {
          throw ApiException.qaTemplateVariableNotFound(exactMatch[1]);
        }
        return val;
      }
      return this.resolveString(data, context);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.resolveJson(item, context));
    }

    if (data !== null && typeof data === 'object') {
      const res: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        res[k] = this.resolveJson(v, context);
      }
      return res;
    }

    return data;
  }

  /**
   * Safely navigate nested object path without eval.
   */
  getValueByPath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let curr: unknown = obj;

    for (const part of parts) {
      if (curr === null || curr === undefined || typeof curr !== 'object') {
        return undefined;
      }
      curr = (curr as Record<string, unknown>)[part];
    }

    return curr;
  }
}

import { ModulesContainer, Reflector } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC, ROLES } from '../src/auth/auth.decorators.js';
import { PlatformGuard } from '../src/platform/platform-auth.js';
import { nestApp } from './helpers.js';

export type RouteRule = { route: string; access: 'public' | 'platform' | 'roles' | 'any-signed-in'; roles?: string[] };

/** Every HTTP route of the app, with the access rule it declares. */
export function routeInventory(): RouteRule[] {
  const app = nestApp();
  const reflector = app.get(Reflector);
  const out: RouteRule[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctrl = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!ctrl) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, ctrl) ?? '');
      const proto = ctrl.prototype as object;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        const handler = desc && "value" in desc ? desc.value : undefined;
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        if (path === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const route = `${method} /${[base, path].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/');
        const targets = [handler, ctrl];
        const guards = [...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []), ...(Reflect.getMetadata(GUARDS_METADATA, ctrl) ?? [])];
        const roles = reflector.getAllAndOverride<string[] | undefined>(ROLES, targets);
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
        if (guards.includes(PlatformGuard)) out.push({ route, access: 'platform' });
        else if (isPublic) out.push({ route, access: 'public' });
        else if (roles) out.push({ route, access: 'roles', roles });
        else out.push({ route, access: 'any-signed-in' });
      }
    }
  }
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'nexacart_is_public';

/**
 * Mark a route or controller as publicly accessible — bypasses the global JwtAuthGuard.
 * Use only for endpoints that genuinely require no authentication.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

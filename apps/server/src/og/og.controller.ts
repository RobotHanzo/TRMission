import { Controller, Get, Header, Param, Query, StreamableFile } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { OgService } from './og.service';
import { env } from '../config/env';

// Unauthenticated by design: crawlers cannot log in. What each endpoint may reveal is
// decided in OgService (room code = join capability; replays only when view-by-link).
// nginx rewrites bot requests for /, /room/* and /replay/* to GET /api/v1/og/page.
const CACHE = 'public, max-age=300';

/**
 * Public origin for absolute og:image/og:url/canonical/sitemap values. Deliberately NOT
 * derived from any request header (Host, X-Forwarded-Host, …): these responses are
 * unauthenticated and cache-public (max-age=300) behind a shared edge cache, so a
 * client-controlled header here would let an attacker poison the cached og:image/canonical/
 * Sitemap origin for every subsequent visitor. `OAUTH_REDIRECT_BASE` is already the
 * deployment's one configured public origin (the SPA and API are required to share it — see
 * its definition in config/env.ts), so it's the correct, trusted source of truth here too.
 */
function baseUrl(): string {
  return env.oauthRedirectBase;
}

@ApiExcludeController()
@Controller('api/v1/og')
export class OgController {
  constructor(private readonly og: OgService) {}

  @Get('page')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', CACHE)
  async page(
    @Query('path') path: string | undefined,
    @Query('code') code: string | undefined,
  ): Promise<string> {
    return this.og.pageHtml(await this.og.pageMeta(path, code), baseUrl());
  }

  // nginx rewrites the site-root /robots.txt and /sitemap.xml here (the Vite dev proxy
  // mirrors that) — absolute URLs are built from the configured origin (baseUrl()), not
  // the request, since these responses are unauthenticated and publicly cached.
  @Get('robots.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', CACHE)
  robots(): string {
    return this.og.robotsTxt(baseUrl());
  }

  @Get('sitemap.xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @Header('Cache-Control', CACHE)
  sitemap(): string {
    return this.og.sitemapXml(baseUrl());
  }

  @Get('site.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  site(): StreamableFile {
    return new StreamableFile(this.og.sitePng());
  }

  @Get('room/:code.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  async room(@Param('code') code: string): Promise<StreamableFile> {
    return new StreamableFile(await this.og.roomPng(code));
  }

  @Get('replay/:gameId.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  async replay(@Param('gameId') gameId: string): Promise<StreamableFile> {
    return new StreamableFile(await this.og.replayPng(gameId));
  }

  @Get('map/:code.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', CACHE)
  async map(@Param('code') code: string): Promise<StreamableFile> {
    return new StreamableFile(await this.og.mapPng(code));
  }
}

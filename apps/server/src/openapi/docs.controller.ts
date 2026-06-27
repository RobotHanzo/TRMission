import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';
import { ApiExcludeEndpoint, type OpenAPIObject } from '@nestjs/swagger';
import { OpenApiHolder } from './openapi.holder';

// Serves the generated spec + a Scalar reference UI (loaded from CDN, so no extra
// server dependency). Explicit @Inject keeps DI working under esbuild (no decorator
// metadata) in tests.
const SCALAR_HTML = `<!doctype html>
<html>
  <head>
    <title>TRMission API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="/api/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;

@Controller()
export class DocsController {
  constructor(@Inject(OpenApiHolder) private readonly holder: OpenApiHolder) {}

  @Get('api/openapi.json')
  @ApiExcludeEndpoint()
  openapi(): OpenAPIObject {
    const doc = this.holder.get();
    if (!doc) throw new NotFoundException('OpenAPI document not built');
    return doc;
  }

  @Get('docs')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/html; charset=utf-8')
  docs(): string {
    return SCALAR_HTML;
  }
}

import { Injectable } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';

// Holds the OpenAPI document, which can only be built once the application graph
// exists. main.ts (and the docs test) build it after init and set it here; the docs
// controller serves it.
@Injectable()
export class OpenApiHolder {
  private document: OpenAPIObject | null = null;

  set(doc: OpenAPIObject): void {
    this.document = doc;
  }

  get(): OpenAPIObject | null {
    return this.document;
  }
}

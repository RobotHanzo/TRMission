import { Injectable, Optional } from '@nestjs/common';
import { env } from './env';

export interface MobileLinksConfigOverrides {
  appleAppId?: string;
  androidPackageName?: string;
  androidCertSha256?: string[];
}

/**
 * App-identity constants for Universal Links (iOS) / App Links (Android) verification.
 * Same test pattern as AuthConfig: Nest builds it from env; specs bind
 * `new MobileLinksConfig(overrides)` via `.useValue(...)`.
 */
@Injectable()
export class MobileLinksConfig {
  readonly appleAppId: string;
  readonly androidPackageName: string;
  readonly androidCertSha256: string[];

  constructor(@Optional() overrides?: MobileLinksConfigOverrides) {
    this.appleAppId = overrides?.appleAppId ?? env.appleAppId;
    this.androidPackageName = overrides?.androidPackageName ?? env.androidPackageName;
    this.androidCertSha256 = overrides?.androidCertSha256 ?? env.androidCertSha256;
  }
}

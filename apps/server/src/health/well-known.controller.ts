import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { MobileLinksConfig } from '../config/mobile-links.config';

/**
 * Deep-link verification files the OS fetches from the web origin. 404 until the app
 * identities are configured, so a deploy without mobile apps serves nothing misleading.
 * The `/room/*` component is what lets tapping a shared room link (e.g. from a chat app)
 * open straight into the app instead of Safari/Chrome — it must match the `Room` route in
 * apps/mobile's navigation `linking` config. OAuth does NOT need an entry here: the mobile
 * OAuth round trip completes via a `trmission://` custom-scheme redirect (AuthConfig.
 * mobileCallback), not a universal/app link — see that method's comment for why.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly links: MobileLinksConfig) {}

  @Get('apple-app-site-association')
  appleAppSiteAssociation() {
    if (!this.links.appleAppId) throw new NotFoundException();
    return {
      applinks: {
        details: [{ appIDs: [this.links.appleAppId], components: [{ '/': '/room/*' }] }],
      },
    };
  }

  @Get('assetlinks.json')
  assetLinks() {
    if (!this.links.androidPackageName || this.links.androidCertSha256.length === 0) {
      throw new NotFoundException();
    }
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: this.links.androidPackageName,
          sha256_cert_fingerprints: this.links.androidCertSha256,
        },
      },
    ];
  }
}

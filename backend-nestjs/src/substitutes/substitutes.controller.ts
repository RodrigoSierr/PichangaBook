import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser, Public, Roles } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { SubstitutesService } from './substitutes.service';

@Controller()
export class SubstitutesController {
  constructor(private readonly substitutes: SubstitutesService) {}

  @Public()
  @Get('substitutes')
  list(
    @Query('position') position?: string,
    @Query('district') district?: string,
    @Query('onlyVerified') onlyVerified?: string,
  ) {
    return this.substitutes.list({ position, district, onlyVerified });
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('substitutes/clip-upload-signature')
  @HttpCode(200)
  signClip(@CurrentUser() user: AuthUser) {
    return this.substitutes.signClipUpload(user);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('substitutes/:id/invite')
  @HttpCode(200)
  invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { bookingId?: string; message?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.substitutes.inviteSubstitute(id, body ?? {}, user);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Get('relays')
  myRelays(@CurrentUser() user: AuthUser) {
    return this.substitutes.myRelays(user);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Get('relays/:id')
  getRelay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.substitutes.getRelay(id, user);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('relays/:id/messages')
  @HttpCode(200)
  sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { text: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.substitutes.sendRelayMessage(id, body.text, user);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, Public, Roles } from '../common/auth/auth.guard';
import { AuthUser } from '../common/types';
import { MAX_SUBSTITUTE_CLIP_BYTES } from '../integrations/media.service';
import {
  InviteSubstituteDto,
  ListSubstitutesQueryDto,
  RespondInvitationDto,
  SendRelayMessageDto,
  UpsertSubstituteProfileDto,
} from './dto/substitutes.dto';
import { SubstitutesService } from './substitutes.service';

@Controller()
export class SubstitutesController {
  constructor(private readonly substitutes: SubstitutesService) {}

  @Public()
  @Get('substitutes')
  list(@Query() query: ListSubstitutesQueryDto) {
    return this.substitutes.list(query);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('substitutes/clip-upload-signature')
  @HttpCode(200)
  signClip(@CurrentUser() user: AuthUser) {
    return this.substitutes.signClipUpload(user);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('substitutes/clip-upload')
  @UseInterceptors(
    FileInterceptor('clip', {
      limits: {
        fileSize: MAX_SUBSTITUTE_CLIP_BYTES,
        files: 1,
      },
    }),
  )
  uploadClip(@CurrentUser() user: AuthUser, @UploadedFile() file: any) {
    return this.substitutes.uploadClipFile(user, file);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('substitutes/profile')
  upsertProfile(@CurrentUser() user: AuthUser, @Body() dto: UpsertSubstituteProfileDto) {
    return this.substitutes.upsertProfile(user, dto);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Post('substitutes/:id/invite')
  @HttpCode(200)
  invite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteSubstituteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.substitutes.inviteSubstitute(id, dto, user);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Get('substitutes/invitations')
  myInvitations(@CurrentUser() user: AuthUser) {
    return this.substitutes.myInvitations(user);
  }

  @Roles('ORGANIZER', 'PLAYER', 'OWNER', 'ADMIN')
  @Patch('substitutes/invitations/:id')
  respondInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondInvitationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.substitutes.respondInvitation(id, dto, user);
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
    @Body() dto: SendRelayMessageDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.substitutes.sendRelayMessage(id, dto.text, user);
  }
}

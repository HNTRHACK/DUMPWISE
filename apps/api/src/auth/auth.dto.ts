import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'demo.analyst@example.invalid' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128) // bounds hashing work per request
  password: string;
}

export class RefreshDto {
  @ApiProperty({ example: 'dwr_…' })
  @IsString()
  @Matches(/^dwr_[A-Za-z0-9_-]{43}$/, { message: 'refreshToken is malformed' })
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ format: 'password', description: '12–128 characters; long passphrases recommended' })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword: string;
}

export class TokenPairDto {
  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';

  @ApiProperty({ description: 'Send as "Authorization: Bearer <accessToken>". Short-lived.' })
  accessToken: string;

  @ApiProperty({ format: 'date-time' })
  accessTokenExpiresAt: string;

  @ApiProperty({ description: 'Single use: exchange at /v1/auth/refresh for a new pair.' })
  refreshToken: string;

  @ApiProperty({ format: 'date-time', description: 'Absolute end of the session; log in again after this.' })
  sessionExpiresAt: string;
}

export class MembershipDto {
  @ApiProperty({ format: 'uuid' })
  organizationId: string;

  @ApiProperty()
  organizationName: string;

  @ApiProperty()
  organizationSlug: string;

  @ApiProperty({ enum: ['SYNTHETIC', 'PRODUCTION'] })
  dataClassification: 'SYNTHETIC' | 'PRODUCTION';

  @ApiProperty({ enum: ['OWNER', 'ANALYST', 'VIEWER'] })
  role: 'OWNER' | 'ANALYST' | 'VIEWER';
}

export class MeDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  displayName: string;

  @ApiProperty({ type: [MembershipDto] })
  memberships: MembershipDto[];
}

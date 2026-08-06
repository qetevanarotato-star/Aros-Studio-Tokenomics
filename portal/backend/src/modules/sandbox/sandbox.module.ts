import { Module } from '@nestjs/common';
import { SandboxController } from './sandbox.controller';
import { AuthModule } from '../auth/auth.module';
import { ProcessesModule } from '../processes/processes.module';

@Module({
  imports: [AuthModule, ProcessesModule],
  controllers: [SandboxController],
})
export class SandboxModule {}

import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { AuthModule } from '../auth/auth.module';
import { ProcessesModule } from '../processes/processes.module';

@Module({
  imports: [AuthModule, ProcessesModule],
  controllers: [OpsController],
})
export class OpsModule {}

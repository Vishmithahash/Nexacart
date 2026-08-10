import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../generated/prisma/client';
import { QaRunnerService } from '../qa-runner.service';
import { QaReportService } from '../qa-report.service';

@ApiTags('QA Framework')
@ApiBearerAuth('bearer')
@Controller('api/v1/qa/runs')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class QaRunsController {
  constructor(
    private readonly qaRunner: QaRunnerService,
    private readonly reportService: QaReportService,
  ) {}

  @Get(':runId')
  @ApiOperation({
    summary: 'Get QA run by ID',
    description: 'Retrieves QA run details, status, and scores. ADMIN only.',
  })
  @ApiResponse({ status: 200, description: 'QA run detail.' })
  @ApiResponse({ status: 404, description: 'QA run not found.' })
  async getRun(@Param('runId') runId: string) {
    return this.qaRunner.getRun(runId);
  }

  @Get(':runId/report')
  @ApiOperation({
    summary: 'Get explainable QA evaluation report',
    description:
      'Retrieves the detailed explainable report for Component 1 (tool correctness) and Component 2 (state consistency). ADMIN only.',
  })
  @ApiResponse({ status: 200, description: 'Detailed explainable QA report.' })
  @ApiResponse({ status: 404, description: 'QA run not found.' })
  async getReport(@Param('runId') runId: string) {
    return this.reportService.generateReport(runId);
  }
}

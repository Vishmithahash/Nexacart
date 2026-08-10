import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../generated/prisma/client';
import { QaScenariosService } from './qa-scenarios.service';
import { QaRunnerService } from '../qa-runner.service';

@ApiTags('QA Framework')
@ApiBearerAuth('bearer')
@Controller('api/v1/qa/scenarios')
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class QaScenariosController {
  constructor(
    private readonly scenariosService: QaScenariosService,
    private readonly qaRunner: QaRunnerService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List active research QA scenarios',
    description: 'Returns all active curated research QA scenarios. ADMIN only.',
  })
  @ApiResponse({ status: 200, description: 'List of QA scenarios.' })
  async listScenarios() {
    return this.scenariosService.listActiveScenarios();
  }

  @Get(':code')
  @ApiOperation({
    summary: 'Get QA scenario detail by code',
    description: 'Returns QA scenario specification by code (e.g. QA-TC-001). ADMIN only.',
  })
  @ApiResponse({ status: 200, description: 'QA scenario detail.' })
  @ApiResponse({ status: 404, description: 'Scenario not found.' })
  async getScenario(@Param('code') code: string) {
    return this.scenariosService.getScenarioByCode(code);
  }

  @Post(':code/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute a research QA scenario',
    description:
      'Orchestrates a complete QA run: fixture setup, BEFORE snapshot, LLM agent run, AFTER snapshot, Component 1 & 2 evaluation, and report generation. ADMIN only.',
  })
  @ApiResponse({ status: 200, description: 'QA run completed.' })
  @ApiResponse({ status: 404, description: 'Scenario not found.' })
  async runScenario(@Param('code') code: string) {
    return this.qaRunner.runScenario(code);
  }
}

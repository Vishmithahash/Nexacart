import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { UserRole } from '../generated/prisma/client';
import { CreateAgentRunDto } from './dto/create-agent-run.dto';
import { AgentService } from './agent.service';

@ApiTags('LLM Agent')
@ApiBearerAuth('bearer')
// With global prefix 'api/v1', the primary route 'agent/runs' maps to canonical '/api/v1/agent/runs'.
// 'api/v1/agent/runs' is retained as an explicit legacy alias for backwards compatibility.
@Controller(['agent/runs', 'api/v1/agent/runs'])
@UseGuards(RolesGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start an autonomous customer LLM agent run',
    description:
      'Executes a customer natural language instruction using structured LLM tool calling and NexaCart business tools. ' +
      'If an agent execution error occurs after the run is created and persisted, the HTTP error response (e.g. 503 LLM_PROVIDER_ERROR, ' +
      '502 LLM_INVALID_RESPONSE, 504 AGENT_EXECUTION_BUDGET_EXCEEDED) includes the server-created `agentRunId`. ' +
      'External QA clients must preserve non-2xx error response bodies to extract `agentRunId` and retrieve the failed trace ' +
      'via authenticated GET /api/v1/agent/runs/:runId with the same customer credentials. Failures occurring prior to run creation ' +
      '(such as invalid blank instruction 400, unauthenticated 401, or forbidden 403) omit `agentRunId`. ' +
      'Note: this retrieval flow addresses cases where an HTTP error response is received; completely lost HTTP connections require a separate correlation lookup.',
  })
  @ApiHeader({
    name: 'X-Request-ID',
    required: false,
    description: 'Optional request correlation ID',
  })
  @ApiHeader({
    name: 'X-QA-Run-ID',
    required: false,
    description: 'Optional QA Framework correlation ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Agent run completed or reached max steps.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Invalid instruction or arguments. If rejected prior to run creation, agentRunId is omitted.',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden (CUSTOMER role required).',
  })
  @ApiResponse({
    status: 502,
    description:
      'LLM invalid response. If run was persisted, error body includes agentRunId for trace retrieval.',
  })
  @ApiResponse({
    status: 503,
    description:
      'LLM provider error or unconfigured. If run was persisted, error body includes agentRunId for trace retrieval.',
  })
  @ApiResponse({
    status: 504,
    description:
      'Agent execution budget exceeded. Error body includes agentRunId for trace retrieval.',
  })
  async startRun(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAgentRunDto,
  ) {
    return this.agentService.startRun(user.id, user.role, dto);
  }

  @Get(':runId')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({
    summary: 'Get an agent run trace by ID',
    description:
      'Retrieves the execution status, final answer, and ordered tool-call trace of a customer agent run.',
  })
  @ApiResponse({ status: 200, description: 'Agent run detail.' })
  @ApiResponse({ status: 401, description: 'Unauthenticated.' })
  @ApiResponse({ status: 404, description: 'Agent run not found.' })
  async getRun(
    @CurrentUser() user: AuthenticatedUser,
    @Param('runId') runId: string,
  ) {
    return this.agentService.getRun(user.id, runId);
  }
}

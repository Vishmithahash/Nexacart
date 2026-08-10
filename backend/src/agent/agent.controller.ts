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
@Controller('api/v1/agent/runs')
@UseGuards(RolesGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start an autonomous customer LLM agent run',
    description:
      'Executes a customer natural language instruction using official OpenAI tool calling and NexaCart business tools.',
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
    description: 'Invalid instruction or arguments.',
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated.' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden (CUSTOMER role required).',
  })
  @ApiResponse({ status: 503, description: 'LLM provider not configured.' })
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

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { UserRole } from '../generated/prisma/client';
import { ApiExceptionFilter } from '../common/filters/api-exception.filter';
import { RequestContextService } from '../common/request-context/request-context.service';
import { ApiException } from '../common/exceptions/api.exception';
import { ExpressAdapter } from '@nestjs/platform-express';

describe('AgentController (HTTP Routing & Access Control)', () => {
  let app: INestApplication;
  let agentService: {
    startRun: jest.Mock;
    getRun: jest.Mock;
  };

  const customerUser = {
    id: 10,
    email: 'customer@nexacart.test',
    role: UserRole.CUSTOMER,
  };

  const adminUser = {
    id: 1,
    email: 'admin@nexacart.test',
    role: UserRole.ADMIN,
  };

  let currentUserForRequest: any = null;

  beforeEach(async () => {
    currentUserForRequest = null;
    agentService = {
      startRun: jest.fn().mockImplementation((userId, role, dto) => {
        return Promise.resolve({
          id: 'test-run-111',
          userId,
          status: 'COMPLETED',
          finalAnswer: 'Found products',
          toolCalls: [],
        });
      }),
      getRun: jest.fn().mockImplementation((userId, runId) => {
        if (runId === 'other-user-run') {
          throw ApiException.agentRunNotFound();
        }
        return Promise.resolve({
          id: runId,
          userId,
          status: 'COMPLETED',
          finalAnswer: 'Found products',
          toolCalls: [],
        });
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        { provide: AgentService, useValue: agentService },
        {
          provide: RequestContextService,
          useValue: {
            getRequestId: () => 'test-req-id',
          },
        },
        RolesGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication(new ExpressAdapter());
    app.setGlobalPrefix('api/v1');

    // Simulate authentication via middleware for HTTP tests
    app.use((req: any, _res: any, next: () => void) => {
      const authHeader = req.headers['authorization'];
      if (authHeader === 'Bearer customer-token') {
        req.user = customerUser;
      } else if (authHeader === 'Bearer admin-token') {
        req.user = adminUser;
      }
      next();
    });

    app.useGlobalFilters(new ApiExceptionFilter(app.get(RequestContextService)));
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /api/v1/agent/runs (Canonical endpoint)', () => {
    it('allows authenticated CUSTOMER to start an agent run', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/runs')
        .set('Authorization', 'Bearer customer-token')
        .send({ instruction: 'Find black shoes' })
        .expect(200);

      expect(response.body.id).toBe('test-run-111');
      expect(response.body.status).toBe('COMPLETED');
      expect(agentService.startRun).toHaveBeenCalledWith(
        customerUser.id,
        UserRole.CUSTOMER,
        expect.objectContaining({ instruction: 'Find black shoes' }),
      );
    });

    it('rejects unauthenticated request with 403 Forbidden via RolesGuard', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/runs')
        .send({ instruction: 'Find black shoes' })
        .expect(403);

      expect(response.body.errorCode).toBe('AUTH_FORBIDDEN');
    });

    it('rejects non-CUSTOMER (e.g. ADMIN) role with 403 Forbidden', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/runs')
        .set('Authorization', 'Bearer admin-token')
        .send({ instruction: 'Admin instruction' })
        .expect(403);

      expect(response.body.errorCode).toBe('AUTH_FORBIDDEN');
      expect(agentService.startRun).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/agent/runs/:runId (Canonical endpoint)', () => {
    it('allows CUSTOMER to get their own agent run by ID', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/agent/runs/test-run-111')
        .set('Authorization', 'Bearer customer-token')
        .expect(200);

      expect(response.body.id).toBe('test-run-111');
      expect(agentService.getRun).toHaveBeenCalledWith(customerUser.id, 'test-run-111');
    });

    it('enforces ownership check and returns 404 if run belongs to another customer', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/agent/runs/other-user-run')
        .set('Authorization', 'Bearer customer-token')
        .expect(404);

      expect(response.body.errorCode).toBe('AGENT_RUN_NOT_FOUND');
    });

    it('rejects non-CUSTOMER accessing run details with 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/agent/runs/test-run-111')
        .set('Authorization', 'Bearer admin-token')
        .expect(403);
    });
  });

  describe('POST /api/v1/api/v1/agent/runs (Legacy alias)', () => {
    it('resolves legacy alias endpoint with customer authorization', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/api/v1/agent/runs')
        .set('Authorization', 'Bearer customer-token')
        .send({ instruction: 'Legacy route query' })
        .expect(200);

      expect(response.body.id).toBe('test-run-111');
    });
  });

  describe('Failed Agent Run Error Response & Trace Retrieval Flow', () => {
    it('returns HTTP error containing server-created agentRunId, original status, code, and requestId for persisted run failure', async () => {
      const persistedRunId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      const failedRun = {
        id: persistedRunId,
        userId: customerUser.id,
        status: 'FAILED',
        errorCode: 'LLM_PROVIDER_ERROR',
        errorMessage: 'Ollama server unreachable at http://localhost:11434.',
        toolCalls: [],
      };
      const ex = ApiException.llmProviderError('Ollama server unreachable at http://localhost:11434.').withAgentRun(
        failedRun,
        persistedRunId,
      );
      agentService.startRun.mockRejectedValueOnce(ex);

      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/runs')
        .set('Authorization', 'Bearer customer-token')
        .send({ instruction: 'Find black shoes' })
        .expect(503);

      expect(response.body.statusCode).toBe(503);
      expect(response.body.errorCode).toBe('LLM_PROVIDER_ERROR');
      expect(response.body.message).toBe('Ollama server unreachable at http://localhost:11434.');
      expect(response.body.agentRunId).toBe(persistedRunId);
      expect(response.body.requestId).toBe('test-req-id');
      expect(response.body.path).toBe('/api/v1/agent/runs');
      expect(response.body.timestamp).toBeDefined();

      // Ensure internal data, prompts, full run, and stack traces are NOT exposed
      expect(response.body.agentRun).toBeUndefined();
      expect(response.body.stack).toBeUndefined();
      expect(response.body.toolCalls).toBeUndefined();
      expect(response.body.prompt).toBeUndefined();
    });

    it('omits agentRunId when failure occurs before run creation (e.g. invalid instruction rejected by agentService)', async () => {
      agentService.startRun.mockRejectedValueOnce(
        ApiException.agentInstructionInvalid('Instruction cannot be blank.'),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/runs')
        .set('Authorization', 'Bearer customer-token')
        .send({ instruction: 'invalid' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.errorCode).toBe('AGENT_INSTRUCTION_INVALID');
      expect(response.body.message).toBe('Instruction cannot be blank.');
      expect(response.body.agentRunId).toBeUndefined();
      expect(response.body.requestId).toBe('test-req-id');
    });

    it('omits agentRunId when request fails DTO validation (e.g. whitespace-only instruction)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/runs')
        .set('Authorization', 'Bearer customer-token')
        .send({ instruction: '   ' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.errorCode).toBe('VALIDATION_ERROR');
      expect(response.body.agentRunId).toBeUndefined();
      expect(response.body.requestId).toBe('test-req-id');
    });

    it('retains standard error shape without agentRunId for unrelated application errors', async () => {
      agentService.startRun.mockRejectedValueOnce(
        ApiException.productNotFound(),
      );

      const response = await request(app.getHttpServer())
        .post('/api/v1/agent/runs')
        .set('Authorization', 'Bearer customer-token')
        .send({ instruction: 'Find shoes' })
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.errorCode).toBe('PRODUCT_NOT_FOUND');
      expect(response.body.agentRunId).toBeUndefined();
      expect(response.body.requestId).toBe('test-req-id');
    });

    it('allows same customer to retrieve persisted failed run and ordered tool evidence via GET /api/v1/agent/runs/:runId', async () => {
      const persistedRunId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      agentService.getRun.mockImplementationOnce((userId, runId) => {
        if (userId === customerUser.id && runId === persistedRunId) {
          return Promise.resolve({
            id: persistedRunId,
            userId: customerUser.id,
            status: 'FAILED',
            errorCode: 'LLM_PROVIDER_ERROR',
            errorMessage: 'Ollama server unreachable.',
            toolCalls: [
              {
                sequenceNumber: 1,
                toolName: 'search_products',
                status: 'SUCCEEDED',
                arguments: { query: 'shoes' },
                result: { products: [{ id: 101, name: 'Running Shoes' }] },
              },
            ],
          });
        }
        throw ApiException.agentRunNotFound();
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/agent/runs/${persistedRunId}`)
        .set('Authorization', 'Bearer customer-token')
        .expect(200);

      expect(response.body.id).toBe(persistedRunId);
      expect(response.body.status).toBe('FAILED');
      expect(response.body.errorCode).toBe('LLM_PROVIDER_ERROR');
      expect(response.body.toolCalls).toHaveLength(1);
      expect(response.body.toolCalls[0].sequenceNumber).toBe(1);
      expect(response.body.toolCalls[0].status).toBe('SUCCEEDED');
    });

    it('rejects another customer attempting to retrieve the failed run with 404', async () => {
      const persistedRunId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      agentService.getRun.mockImplementationOnce((_userId, _runId) => {
        throw ApiException.agentRunNotFound();
      });

      const response = await request(app.getHttpServer())
        .get(`/api/v1/agent/runs/${persistedRunId}`)
        .set('Authorization', 'Bearer customer-token')
        .expect(404);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.errorCode).toBe('AGENT_RUN_NOT_FOUND');
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

const mockHealthService = {
  getAppHealth: jest.fn().mockReturnValue({
    status: 'ok',
    application: 'NexaCart API',
  }),
  getDatabaseHealth: jest.fn().mockResolvedValue({
    status: 'ok',
    database: 'connected',
  }),
};

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /health', () => {
    it('should return status ok and application name', () => {
      const result = controller.getAppHealth();
      expect(result).toEqual({
        status: 'ok',
        application: 'NexaCart API',
      });
    });

    it('should return status property as "ok"', () => {
      const result = controller.getAppHealth();
      expect(result.status).toBe('ok');
    });

    it('should return application name as "NexaCart API"', () => {
      const result = controller.getAppHealth();
      expect(result.application).toBe('NexaCart API');
    });
  });

  describe('GET /health/database', () => {
    it('should return status ok and database connected', async () => {
      const result = await controller.getDatabaseHealth();
      expect(result).toEqual({
        status: 'ok',
        database: 'connected',
      });
    });

    it('should return database property as "connected" when healthy', async () => {
      const result = await controller.getDatabaseHealth();
      expect(result.database).toBe('connected');
    });
  });
});

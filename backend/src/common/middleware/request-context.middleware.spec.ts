import { RequestContextMiddleware } from './request-context.middleware';
import { RequestContextService } from '../request-context/request-context.service';

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let contextService: RequestContextService;

  beforeEach(() => {
    contextService = new RequestContextService();
    middleware = new RequestContextMiddleware(contextService);
  });

  it('should generate a UUID for X-Request-ID if missing and set response header', () => {
    const req: any = {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res: any = {
      setHeader: jest.fn(),
    };
    const next = jest.fn().mockImplementation(() => {
      expect(contextService.getRequestId()).toBeDefined();
      expect(contextService.getRequestId()).toHaveLength(36); // UUID format length
    });

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-ID',
      expect.any(String),
    );
    expect(next).toHaveBeenCalled();
  });

  it('should preserve custom X-Request-ID if valid', () => {
    const req: any = {
      headers: { 'x-request-id': 'custom-request-id-123' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res: any = {
      setHeader: jest.fn(),
    };
    const next = jest.fn().mockImplementation(() => {
      expect(contextService.getRequestId()).toBe('custom-request-id-123');
    });

    middleware.use(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Request-ID',
      'custom-request-id-123',
    );
    expect(next).toHaveBeenCalled();
  });

  it('should extract X-QA-Run-ID and X-Tool-Call-ID headers into context', () => {
    const req: any = {
      headers: {
        'x-request-id': 'req-1',
        'x-qa-run-id': 'qa-run-456',
        'x-tool-call-id': 'tool-call-789',
      },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res: any = {
      setHeader: jest.fn(),
    };
    const next = jest.fn().mockImplementation(() => {
      expect(contextService.getQaRunId()).toBe('qa-run-456');
      expect(contextService.getToolCallId()).toBe('tool-call-789');
    });

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

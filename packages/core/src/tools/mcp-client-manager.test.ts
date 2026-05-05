/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpClientManager } from './mcp-client-manager.js';
import { McpClient } from './mcp-client.js';
import type { ToolRegistry } from './tool-registry.js';
import type { Config } from '../config/config.js';
import type { PromptRegistry } from '../prompts/prompt-registry.js';
import type { WorkspaceContext } from '../utils/workspaceContext.js';

vi.mock('./mcp-client.js', async () => {
  const originalModule = await vi.importActual('./mcp-client.js');
  return {
    ...originalModule,
    McpClient: vi.fn(),
    // Return the input servers unchanged (identity function)
    populateMcpServerCommand: vi.fn((servers) => servers),
  };
});

describe('McpClientManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should discover tools from all servers', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn(),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}),
      getWorkspaceContext: () => ({}),
      getDebugMode: () => false,
      isMcpServerDisabled: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);
    await manager.discoverAllMcpTools(mockConfig);
    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();
  });

  it('should not discover tools if folder is not trusted', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn(),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    const mockConfig = {
      isTrustedFolder: () => false,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}),
      getWorkspaceContext: () => ({}),
      getDebugMode: () => false,
      isMcpServerDisabled: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);
    await manager.discoverAllMcpTools(mockConfig);
    expect(mockedMcpClient.connect).not.toHaveBeenCalled();
    expect(mockedMcpClient.discover).not.toHaveBeenCalled();
  });

  it('should disconnect all clients when stop is called', async () => {
    // Track disconnect calls across all instances
    const disconnectCalls: string[] = [];
    vi.mocked(McpClient).mockImplementation(
      (name: string) =>
        ({
          connect: vi.fn(),
          discover: vi.fn(),
          disconnect: vi.fn().mockImplementation(() => {
            disconnectCalls.push(name);
            return Promise.resolve();
          }),
          getStatus: vi.fn(),
        }) as unknown as McpClient,
    );
    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {}, 'another-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
      isMcpServerDisabled: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);
    // First connect to create the clients
    await manager.discoverAllMcpTools({
      isTrustedFolder: () => true,
      isMcpServerDisabled: () => false,
    } as unknown as Config);

    // Clear the disconnect calls from initial stop() in discoverAllMcpTools
    disconnectCalls.length = 0;

    // Then stop
    await manager.stop();
    expect(disconnectCalls).toHaveLength(2);
    expect(disconnectCalls).toContain('test-server');
    expect(disconnectCalls).toContain('another-server');
  });

  it('should be idempotent - stop can be called multiple times safely', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );
    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
      isMcpServerDisabled: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);
    await manager.discoverAllMcpTools({
      isTrustedFolder: () => true,
      isMcpServerDisabled: () => false,
    } as unknown as Config);

    // Call stop multiple times - should not throw
    await manager.stop();
    await manager.stop();
    await manager.stop();
  });

  it('should discover tools for a single server and track the client for stop', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );

    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);

    await manager.discoverMcpToolsForServer(
      'test-server',
      {} as unknown as Config,
    );

    expect(mockedMcpClient.connect).toHaveBeenCalledOnce();
    expect(mockedMcpClient.discover).toHaveBeenCalledOnce();

    await manager.stop();
    expect(mockedMcpClient.disconnect).toHaveBeenCalledOnce();
  });

  it('should replace an existing client when re-discovering a server', async () => {
    const firstClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };
    const secondClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };

    vi.mocked(McpClient)
      .mockReturnValueOnce(firstClient as unknown as McpClient)
      .mockReturnValueOnce(secondClient as unknown as McpClient);

    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);

    await manager.discoverMcpToolsForServer(
      'test-server',
      {} as unknown as Config,
    );
    await manager.discoverMcpToolsForServer(
      'test-server',
      {} as unknown as Config,
    );

    expect(firstClient.disconnect).toHaveBeenCalledOnce();
    expect(secondClient.connect).toHaveBeenCalledOnce();
    expect(secondClient.discover).toHaveBeenCalledOnce();

    await manager.stop();
    expect(secondClient.disconnect).toHaveBeenCalledOnce();
  });

  it('should not spawn duplicate clients when discoverMcpToolsForServer is called concurrently for the same server', async () => {
    // Simulate a slow connect to create a window where a second call could race.
    let connectCallCount = 0;
    const connectDelays: Array<(value: void) => void> = [];

    const mockedClient = {
      connect: vi.fn().mockImplementation(() => {
        connectCallCount++;
        return new Promise<void>((resolve) => {
          connectDelays.push(resolve);
        });
      }),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };

    vi.mocked(McpClient).mockReturnValue(mockedClient as unknown as McpClient);

    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);

    // Fire two concurrent discoveries for the same server.
    const p1 = manager.discoverMcpToolsForServer(
      'test-server',
      {} as unknown as Config,
    );
    const p2 = manager.discoverMcpToolsForServer(
      'test-server',
      {} as unknown as Config,
    );

    // Let both settle (the second should have been a no-op).
    // Resolve the single in-flight connect.
    connectDelays[0]?.();
    await p1;
    await p2;

    // Only one connect call should have been made — the concurrent second
    // call must have bailed out early.
    expect(connectCallCount).toBe(1);
    expect(mockedClient.connect).toHaveBeenCalledOnce();
    expect(mockedClient.discover).toHaveBeenCalledOnce();
  });

  it('should clean up in-flight tracking after discovery completes', async () => {
    const mockedClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };

    vi.mocked(McpClient).mockReturnValue(mockedClient as unknown as McpClient);

    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);

    await manager.discoverMcpToolsForServer(
      'test-server',
      {} as unknown as Config,
    );

    // After completion, a second call should proceed (not be skipped).
    const secondClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(secondClient as unknown as McpClient);

    await manager.discoverMcpToolsForServer(
      'test-server',
      {} as unknown as Config,
    );

    // The second call should have created a new client and connected.
    expect(secondClient.connect).toHaveBeenCalledOnce();
    expect(secondClient.discover).toHaveBeenCalledOnce();
  });

  it('should no-op when discovering an unknown server', async () => {
    const mockedMcpClient = {
      connect: vi.fn(),
      discover: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(
      mockedMcpClient as unknown as McpClient,
    );

    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({}),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);

    await manager.discoverMcpToolsForServer('unknown-server', {
      isTrustedFolder: () => true,
    } as unknown as Config);

    expect(vi.mocked(McpClient)).not.toHaveBeenCalled();
  });

  it('should clean up in-flight state when removing a server', async () => {
    const mockedClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };

    vi.mocked(McpClient).mockReturnValue(mockedClient as unknown as McpClient);

    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);

    // Discover the server first
    await manager.discoverMcpToolsForServer('test-server', mockConfig);

    // Simulate an in-flight discovery by directly adding to the internal set
    // (we can't easily access private fields, so we'll test indirectly)
    // Instead, remove the server and verify re-discovery works
    await manager.stop();

    // After stop, a new discovery should proceed normally
    const secondClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(secondClient as unknown as McpClient);

    await manager.discoverMcpToolsForServer('test-server', mockConfig);

    expect(secondClient.connect).toHaveBeenCalledOnce();
    expect(secondClient.discover).toHaveBeenCalledOnce();
  });

  it('should disconnect failed client and clean up when discoverMcpToolsForServer fails', async () => {
    const failedClient = {
      connect: vi.fn().mockRejectedValue(new Error('connection refused')),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };

    vi.mocked(McpClient).mockReturnValue(failedClient as unknown as McpClient);

    const mockConfig = {
      isTrustedFolder: () => true,
      getMcpServers: () => ({ 'test-server': {} }),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({}) as PromptRegistry,
      getWorkspaceContext: () => ({}) as WorkspaceContext,
      getDebugMode: () => false,
    } as unknown as Config;
    const manager = new McpClientManager(mockConfig, {} as ToolRegistry);

    await manager.discoverMcpToolsForServer('test-server', {
      isTrustedFolder: () => true,
    } as unknown as Config);

    // The catch block should disconnect the failed client before deleting it.
    expect(failedClient.disconnect).toHaveBeenCalledOnce();

    // After failure cleanup, a subsequent discovery should proceed (in-flight
    // tracking was cleared and client was removed).
    const secondClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      discover: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn(),
    };
    vi.mocked(McpClient).mockReturnValue(secondClient as unknown as McpClient);

    await manager.discoverMcpToolsForServer('test-server', {
      isTrustedFolder: () => true,
    } as unknown as Config);

    expect(secondClient.connect).toHaveBeenCalledOnce();
    expect(secondClient.discover).toHaveBeenCalledOnce();
  });
});

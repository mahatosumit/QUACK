import type { RemoteConnection, RemoteFileInfo } from "./types.js";

export class RemoteExecution {
  private connections: Map<string, RemoteConnection> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    for (const conn of this.connections.values()) {
      conn.authenticated = false;
    }
    this.initialized = false;
  }

  async connect(id: string, host: string, port: number, connType: "ssh" | "tcp" | "ws" | "tls" = "ssh", user = "root"): Promise<RemoteConnection> {
    throw new Error("Remote connect is unsupported: no authenticated transport is configured.");
  }

  async disconnect(id: string): Promise<boolean> {
    throw new Error("Remote disconnect is unsupported: no authenticated transport is configured.");
  }

  async reconnect(id: string): Promise<boolean> {
    throw new Error("Remote reconnect is unsupported: no authenticated transport is configured.");
  }

  getConnection(id: string): RemoteConnection | undefined {
    return this.connections.get(id);
  }

  getActiveConnections(): RemoteConnection[] {
    return Array.from(this.connections.values()).filter((c) => c.authenticated);
  }

  getAllConnections(): RemoteConnection[] {
    return Array.from(this.connections.values());
  }

  async execCommand(connectionId: string, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    throw new Error("Remote execCommand is unsupported: no authenticated transport is configured.");
  }

  async uploadFile(connectionId: string, _localPath: string, _remotePath: string): Promise<boolean> {
    throw new Error("Remote uploadFile is unsupported: no authenticated transport is configured.");
  }

  async downloadFile(connectionId: string, _remotePath: string, _localPath: string): Promise<boolean> {
    throw new Error("Remote downloadFile is unsupported: no authenticated transport is configured.");
  }

  async readFile(connectionId: string, remotePath: string): Promise<string | null> {
    throw new Error("Remote readFile is unsupported: no authenticated transport is configured.");
  }

  async writeFile(connectionId: string, _remotePath: string, _content: string): Promise<boolean> {
    throw new Error("Remote writeFile is unsupported: no authenticated transport is configured.");
  }

  async listFiles(connectionId: string, remotePath: string): Promise<RemoteFileInfo[]> {
    throw new Error("Remote listFiles is unsupported: no authenticated transport is configured.");
  }

  async deleteFile(connectionId: string, _remotePath: string): Promise<boolean> {
    throw new Error("Remote deleteFile is unsupported: no authenticated transport is configured.");
  }

  async createDirectory(connectionId: string, _remotePath: string): Promise<boolean> {
    throw new Error("Remote createDirectory is unsupported: no authenticated transport is configured.");
  }

  async deleteDirectory(connectionId: string, _remotePath: string): Promise<boolean> {
    throw new Error("Remote deleteDirectory is unsupported: no authenticated transport is configured.");
  }

  async checkConnectionStatus(connectionId: string): Promise<boolean> {
    throw new Error("Remote checkConnectionStatus is unsupported: no authenticated transport is configured.");
  }
}

// Nezha Monitoring Module - gRPC 上报系统状态
// 简化版，用于 Vercel 环境

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const path = require('path');

let server = null;
let port = 0;
let heartbeatInterval = null;

// 简化的 proto 定义（与哪吒兼容）
const serviceDefinition = `
syntax = "proto3";
package nezha;

message Report {
  string hostname = 1;
  string ip = 2;
  bool online = 3;
  double load = 4;
  int32 cpu = 5;
  int32 cores = 6;
  double mem = 7;
  double disk = 8;
  double diskio = 9;
  double netio = 10;
  repeated string messages = 11;
}

service Monitor {
  rpc ReportData (Report) returns (google.protobuf.Empty) {};
}
`;

let grpcService;
let reportChannel;
let reportStub;

function makeGrpcServer(key) {
  // 生成简化的 gRPC 服务端（用于模拟哪吒上报）
  const packageDefinition = protoLoader.loadSync({
    root: '',
    file: 'nezha.proto',
  });
  
  // 创建临时 proto 文件
  const tmpDir = '/tmp';
  const protoPath = path.join(tmpDir, 'nezha.proto');
  fs.writeFileSync(protoPath, serviceDefinition);
  
  const packageDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  
  grpcService = grpc.loadPackageDefinition(packageDef).nezha || {};
  
  // 启动本地 gRPC 服务
  server = new grpc.Server();
  
  // 简单的 ReportData handler
  if (grpcService.Monitor && grpcService.Monitor.service) {
    server.addService(grpcService.Monitor.service, {
      ReportData: (call, callback) => {
        // 存储上报数据（用于本地监控）
        console.log('[Nezha] Report received');
        callback(null, {});
      }
    });
  }
}

async function startGrpcServer() {
  if (!server) return;
  
  return new Promise((resolve, reject) => {
    server.bindAsync('0.0.0.0:0', grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) {
        reject(err);
        return;
      }
      port = boundPort;
      console.log(`[Nezha] gRPC server started on port ${port}`);
      
      // 启动定期心跳
      heartbeatInterval = setInterval(() => {
        if (reportChannel) {
          // 可以在这里发送心跳
        }
      }, 60000);
      
      resolve();
    });
  });
}

async function stopGrpcServer() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  if (reportChannel) {
    reportChannel.close();
    reportChannel = null;
  }
  
  if (server) {
    return new Promise((resolve) => {
      server.tryShutdown(() => resolve());
    });
  }
}

function reportData(data) {
  // 模拟上报数据到哪吒服务器
  // 实际部署时，这里会连接到真正的哪吒服务器
  if (!NEZHA_SERVER) return;
  
  // 使用 gRPC 上报
  console.log('[Nezha] Reporting:', data.hostname, 'online:', data.online);
}

// 导出
module.exports = {
  makeGrpcServer,
  startGrpcServer,
  stopGrpcServer,
  reportData,
};
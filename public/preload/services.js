const fs = require('node:fs')
const path = require('node:path')
const { exec } = require('node:child_process')

// 通过 window 对象向渲染进程注入 nodejs 能力
window.services = {
  // 读文件
  
  // 测试Bitwarden CLI连接
  testBitwardenConnection: async function(bwPath, clientId, clientSecret) {
    try {
      // 设置环境变量
      const env = { ...process.env };
      if (clientId) {
        env.BW_CLIENTID = clientId;
      }
      if (clientSecret) {
        env.BW_CLIENTSECRET = clientSecret;
      }
      
      // 执行命令
      const result = await new Promise((resolve, reject) => {
        exec(`"${bwPath}" --version`, { env }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          if (stderr) {
            reject(new Error(stderr));
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      // 验证输出是否符合版本号格式
      if (result && /^\d+\.\d+\.\d+$/.test(result.toString())) {
        return {
          success: true,
          version: result.toString()
        };
      } else {
        throw new Error('无法识别的Bitwarden CLI版本格式');
      }
    } catch (error) {
      console.error('测试Bitwarden CLI连接错误:', error);
      return {
        success: false,
        error: error.message || '未知错误'
      };
    }
  },
  
  // 获取Bitwarden密码
  getBitwardenPasswords: async function(bwPath, clientId, clientSecret, session = null) {
    try {
      // 设置环境变量
      const env = { ...process.env };
      if (clientId) {
        env.BW_CLIENTID = clientId;
      }
      if (clientSecret) {
        env.BW_CLIENTSECRET = clientSecret;
      }
      if (session) {
        env.BW_SESSION = session;
      }
      
      // 检查是否已登录
      const statusCmd = session ? 
        `"${bwPath}" status --session "${session}"` : 
        `"${bwPath}" status`;
        
      const statusResult = await new Promise((resolve, reject) => {
        exec(statusCmd, { env }, (error, stdout, stderr) => {
          // 命令执行错误不一定是真正的错误，可能是会话密钥过期
          if (error && !stdout) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      let statusData;
      try {
        statusData = JSON.parse(statusResult);
      } catch (e) {
        // 如果是使用了保存的会话但无法解析，很可能是会话已过期
        return {
          success: false,
          error: '会话已过期，需要重新登录',
          status: 'locked'
        };
      }
      
      // 如果没有登录，返回未授权错误
      if (statusData.status !== 'unlocked') {
        return {
          success: false,
          error: '需要先解锁Bitwarden',
          status: statusData.status
        };
      }
      
      // 获取密码列表
      const listCmd = session ? 
        `"${bwPath}" list items --pretty --session "${session}"` : 
        `"${bwPath}" list items --pretty`;
        
      const listResult = await new Promise((resolve, reject) => {
        exec(listCmd, { env }, (error, stdout, stderr) => {
          if (error) {
            // 如果是使用了保存的会话但命令失败，很可能是会话已过期
            if (session) {
              resolve(JSON.stringify({
                success: false,
                error: '会话已过期，需要重新登录',
                status: 'locked'
              }));
              return;
            }
            reject(error);
            return;
          }
          if (stderr) {
            reject(new Error(stderr));
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      let passwordItems;
      try {
        // 检查是否已经是错误响应格式
        if (listResult.includes('"success":false')) {
          return JSON.parse(listResult);
        }
        
        passwordItems = JSON.parse(listResult);
      } catch (e) {
        throw new Error('无法解析Bitwarden密码数据');
      }
      
      // 获取文件夹列表
      const folderCmd = session ? 
        `"${bwPath}" list folders --pretty --session "${session}"` : 
        `"${bwPath}" list folders --pretty`;
        
      const folderResult = await new Promise((resolve, reject) => {
        exec(folderCmd, { env }, (error, stdout, stderr) => {
          if (error) {
            // 如果之前的命令成功但这个失败，可能是临时网络问题
            reject(error);
            return;
          }
          if (stderr) {
            reject(new Error(stderr));
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      let folders;
      try {
        folders = JSON.parse(folderResult);
      } catch (e) {
        throw new Error('无法解析Bitwarden文件夹数据');
      }
      
      return {
        success: true,
        items: passwordItems,
        folders: folders
      };
    } catch (error) {
      console.error('获取Bitwarden密码错误:', error);
      
      // 判断是否是会话失效的错误
      if (session && (
          error.message.includes('not authenticated') || 
          error.message.includes('session') || 
          error.message.includes('unauthorized') ||
          error.message.includes('Invalid'))) {
        return {
          success: false,
          error: '会话已过期，需要重新登录',
          status: 'locked'
        };
      }
      
      return {
        success: false,
        error: error.message || '未知错误'
      };
    }
  },
  
  // 解锁Bitwarden
  unlockBitwarden: async function(bwPath, password, clientId, clientSecret) {
    try {
      // 设置环境变量
      const env = { ...process.env };
      if (clientId) {
        env.BW_CLIENTID = clientId;
      }
      if (clientSecret) {
        env.BW_CLIENTSECRET = clientSecret;
      }
      
      // 执行解锁命令
      const result = await new Promise((resolve, reject) => {
        // 使用echo传递密码到标准输入
        const child = exec(`echo "${password}" | "${bwPath}" unlock --raw`, { env }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          if (stderr) {
            console.warn('Bitwarden解锁警告:', stderr);
          }
          resolve(stdout.trim());
        });
      });
      
      // 检查是否返回了会话密钥
      if (result && result.length > 10) {
        return {
          success: true,
          sessionKey: result // 返回会话密钥供后续命令使用
        };
      } else {
        throw new Error('解锁失败，无效的会话密钥');
      }
    } catch (error) {
      console.error('解锁Bitwarden错误:', error);
      return {
        success: false,
        error: error.message || '未知错误'
      };
    }
  },
  
  // 生成TOTP验证码
  generateTOTP: async function(bwPath, itemId, session) {
    try {
      if (!session || !itemId || !bwPath) {
        return { success: false, error: '参数错误' };
      }
      
      const env = { ...process.env };
      env.BW_SESSION = session;
      
      // 使用Bitwarden CLI生成TOTP验证码
      const cmd = `"${bwPath}" get totp ${itemId} --session "${session}"`;
      
      const result = await new Promise((resolve, reject) => {
        exec(cmd, { env }, (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        });
      });
      
      return {
        success: true,
        code: result
      };
    } catch (error) {
      console.error('生成TOTP验证码错误:', error);
      return {
        success: false,
        error: error.message || '生成验证码失败'
      };
    }
  }
}

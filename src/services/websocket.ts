import { CharacterHistory } from '@/types/drama';
import { OperateTweetRequest, OperateTweetResponse } from '@/types/drama';
import { MOCK_SCENE_CHARACTER_HISTORY } from '@/mock/scene-data';

// 环境配置
const ENV = {
  TEST: 'test',
  PROD: 'production'
};

// WebSocket 服务器配置
const WS_SERVERS = {
  [ENV.TEST]: 'wss://dramai.world/api/ws',
  [ENV.PROD]: 'wss://dramai.world/api/ws'
};

// 当前环境
const CURRENT_ENV = process.env.NODE_ENV === 'development' ? ENV.TEST : ENV.PROD;

// Command types
export const Commands = {
  LOGIN: 10000,
  GET_SCENE_FEED: 10112,  // 获取场景推文数据
  VOTE_THREAD: 10119,     // 获取投票历史
  GET_CHARACTER_HISTORY: 10114,  // 获取角色历史聊天记录
  OPERATE_TWEET: 10113,   // 操作推文(点赞、评论等)
};

// 定义新的接口类型
interface LoginRequestData {
  loginType: number;
  name: string;
  password: string;
  nickName: string;
  avatar: number;
  sex: number;
  timeZone: number;
  clientOs: string;
  userId: string;
  inviteCode: string;
  invite: string;
  address: string;
}

interface Tweet {
  id: number;
  content: string;
  author: string;
  avatar: string;
  timestamp: string;
  voteCount: number;
  commentCount: number;
  isLiked: boolean;
}

interface SceneFeedResponse {
  roomId: number;
  tweetVoList: Tweet[];
}

interface LoginResponseData {
  token: string;
  timestamp: number;
  player: {
    playerId: string;
    charater: number;
    loginType: number;
    address: string;
  };
}

interface InetwarkResponseData {
  requestId: number;
  playerId?: number;
  type: number;
  command: number;
  code: number;
  message: string;
  data: LoginResponseData | SceneFeedResponse;
}

interface WebSocketEvent {
  command: number;
  data: any;
  code: number;
  message: string;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private eventHandlers: Map<number, ((event: WebSocketEvent) => void)[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isLoggedIn = false;
  private pendingRequests: { command: number; data: any }[] = [];

  constructor() {
    if (CURRENT_ENV === ENV.PROD) {
      console.log('Running in production environment, connecting to production WebSocket server');
    } else {
      console.log('Running in development environment, connecting to test WebSocket server');
    }
    this.connect();
  }

  private connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket is already connected');
      return;
    }

    try {
      const wsUrl = WS_SERVERS[CURRENT_ENV];
      console.log(`Connecting to ${CURRENT_ENV} WebSocket server: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`WebSocket connected to ${CURRENT_ENV} server`);
        this.reconnectAttempts = 0;
        
        // 检查是否已有登录信息，如果有则自动登录
        const storedUserInfo = localStorage.getItem('userInfo');
        const storedLoginStatus = localStorage.getItem('isSignedIn');
        
        if (storedUserInfo && storedLoginStatus) {
          // 如果用户已经登录过，使用存储的信息进行自动登录
          const userInfo = JSON.parse(storedUserInfo);
          if (userInfo.userId.includes('@')) {
            // 如果是邮箱格式，说明是Google登录
            const googleUser = {
              getBasicProfile: () => ({
                getEmail: () => userInfo.userId,
                getName: () => userInfo.userId.split('@')[0],
                getId: () => userInfo.id
              })
            };
            this.googleLogin(googleUser);
          } else {
            // 否则使用普通登录
            const loginData: LoginRequestData = {
              loginType: 1,
              name: userInfo.userId,
              password: 'stored_session',
              nickName: userInfo.userId,
              avatar: 0,
              sex: 1,
              timeZone: 2,
              clientOs: 'web',
              userId: userInfo.id,
              inviteCode: '',
              invite: '',
              address: ''
            };
            this.login(loginData);
          }
        } else {
          console.log('No stored login information, waiting for user to login manually');
        }
      };

      this.ws.onmessage = (event) => {
        try {
          if (typeof event.data === 'string') {
            const response = JSON.parse(event.data) as InetwarkResponseData;
            console.log('Received message from server:', {
              timestamp: new Date().toISOString(),
              rawMessage: event.data,
              command: response.command,
              code: response.code,
              errorMessage: response.message
            });

            // 处理登录响应
            if (response.command === Commands.LOGIN) {
              this.processLoginResponse(response);
            }

            // 触发对应命令的事件处理器
            const handlers = this.eventHandlers.get(response.command);
            if (handlers) {
              const event: WebSocketEvent = {
                command: response.command,
                data: response.data,
                code: response.code,
                message: response.message
              };
              handlers.forEach(handler => handler(event));
            }
          } else {
            console.warn('Received non-text message, ignoring:', event.data);
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isLoggedIn = false;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('Error connecting to WebSocket:', error);
    }
  }

  // 注册事件处理器
  on(command: number, handler: (event: WebSocketEvent) => void) {
    if (!this.eventHandlers.has(command)) {
      this.eventHandlers.set(command, []);
    }
    this.eventHandlers.get(command)?.push(handler);
  }

  // 移除事件处理器
  off(command: number, handler: (event: WebSocketEvent) => void) {
    const handlers = this.eventHandlers.get(command);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  // 添加连接状态检查
  isConnectionOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  
  // 等待连接建立
  private waitForConnection(timeout = 5000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (this.isConnectionOpen()) {
        resolve(true);
        return;
      }
      
      // 如果未连接，则等待onopen事件或超时
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      
      const checkInterval = setInterval(() => {
        if (this.isConnectionOpen()) {
          clearInterval(checkInterval);
          if (timeoutId) clearTimeout(timeoutId);
          resolve(true);
        }
      }, 100);
      
      timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        console.warn('WebSocket connection timeout');
        resolve(false);
      }, timeout);
    });
  }

  async send(command: number, data: any) {
    try {
      // 等待连接建立
      if (!this.isConnectionOpen()) {
        console.log('WebSocket not connected, waiting for connection...');
        const connected = await this.waitForConnection();
        if (!connected) {
          console.error('Failed to establish WebSocket connection');
          // 将请求添加到待处理队列
          this.pendingRequests.push({ command, data });
          return;
        }
      }

      if (command !== Commands.LOGIN && !this.isLoggedIn) {
        console.log('Not logged in, adding request to pending queue:', command);
        this.pendingRequests.push({ command, data });
        return;
      }

      const message = {
        requestId: 0, // 不再使用 requestId 进行消息匹配
        type: 1,
        command,
        data
      };
      
      const jsonMessage = JSON.stringify(message);
      console.log('Sending message to server:', {
        timestamp: new Date().toISOString(),
        message: jsonMessage,
        command: command,
        data: data
      });
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(jsonMessage);
      } else {
        console.error('WebSocket连接未就绪，无法发送消息');
        // 将请求添加到待处理队列
        this.pendingRequests.push({ command, data });
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // 发生错误时，将请求添加到待处理队列
      this.pendingRequests.push({ command, data });
    }
  }

  // 测试所有业务功能
  public testAllFeatures() {
    console.log('Testing all features...');
    
    // 测试获取场景Feed
    this.getSceneFeed();
    
    // 测试获取角色历史
    this.getCharacterHistory();
    
    // 测试投票功能
    this.voteThread('test_thread', true);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // Business methods
  login(loginData: LoginRequestData) {
    this.send(Commands.LOGIN, loginData)
    console.log('Commands.LOGIN', Commands.LOGIN);
    console.log('loginData', loginData);
  }

  // 手动普通登录方法
  manualLogin(username: string, password: string, nickname?: string) {
    const loginData: LoginRequestData = {
      loginType: 1,
      name: username,
      password: password,
      nickName: nickname || username,
      avatar: 0,
      sex: 1,
      timeZone: 2,
      clientOs: 'web',
      userId: '',
      inviteCode: '',
      invite: '',
      address: ''
    };
    this.login(loginData);
  }

  getSceneFeed(roomId: number = 0, page: number = 0, size: number = 100) {
    this.send(Commands.GET_SCENE_FEED, { roomId , page, size });
  }

  operateTweet(tweetId: number, type: number, content: string, replyId: number, chooseIndex: number, rateList?: number[]) {
    // 获取用户信息
    const storedUserInfo = localStorage.getItem('userInfo');
    const userInfo = storedUserInfo ? JSON.parse(storedUserInfo) : null;
    const playerId = localStorage.getItem('playerId') || '';
    
    const requestData: OperateTweetRequest = {
      tweetId,
      type,
      content,
      replyId,
      chooseIndex,
      nickName: userInfo?.userId || '',
      userNo: userInfo?.id || '',
      commentId: 0, // 新增：评论ID，新评论时为0
      rateList: rateList || []  // 使用传入的rateList或默认空数组
    };

    // 构建完整的请求消息，包含playerId
    const message = {
      requestId: 0,
      playerId: playerId, // 新增：玩家ID
      type: 1,
      command: Commands.OPERATE_TWEET,
      data: requestData
    };
    
    const jsonMessage = JSON.stringify(message);
    console.log('Sending OPERATE_TWEET message:', {
      timestamp: new Date().toISOString(),
      message: jsonMessage,
      command: Commands.OPERATE_TWEET,
      data: requestData
    });
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(jsonMessage);
    } else {
      console.error('WebSocket连接未就绪，无法发送推文操作请求');
      this.pendingRequests.push({ command: Commands.OPERATE_TWEET, data: requestData });
    }
  }

  voteThread(threadId: string, isUpvote: boolean) {
    this.send(Commands.VOTE_THREAD, {
      postId: threadId,
      vote: isUpvote ? 1 : -1
    });
  }

  getCharacterHistory(pageSize: number = 10, pageNum: number = 1) {
    this.send(Commands.GET_CHARACTER_HISTORY, {
      pageSize,
      pageNum
    });
  }

  public subscribe(handler: (message: any) => void) {
    this.on(Commands.GET_SCENE_FEED, (event: WebSocketEvent) => {
      if (event.command === Commands.GET_SCENE_FEED) {
        handler(event.data);
      }
    });
  }

  public unsubscribe(handler: (message: any) => void) {
    this.off(Commands.GET_SCENE_FEED, (event: WebSocketEvent) => {
      if (event.command === Commands.GET_SCENE_FEED) {
        handler(event.data);
      }
    });
  }

  // 处理 Google 登录
  googleLogin(googleUser: any) {
    const loginData: LoginRequestData = {
      loginType: 2, // Google 登录类型
      name: googleUser.getBasicProfile().getEmail(),
      password: '', // Google 登录不需要密码
      nickName: googleUser.getBasicProfile().getName(),
      avatar: 0, // 默认头像
      sex: 1, // 默认性别
      timeZone: 2, // 默认时区
      clientOs: "web",
      userId: googleUser.getBasicProfile().getId(),
      inviteCode: '',
      invite: '',
      address: ''
    };

    this.login(loginData);
  }

  // 处理 Apple 登录
  appleLogin(appleUserData: { userId: string; email?: string; name?: string }) {
    const loginData: LoginRequestData = {
      loginType: 3, // Apple 登录类型
      name: appleUserData.email || appleUserData.userId,
      password: '', // Apple 登录不需要密码
      nickName: appleUserData.name || (appleUserData.email ? appleUserData.email.split('@')[0] : `apple_${appleUserData.userId.substring(0, 8)}`),
      avatar: 0, // 默认头像
      sex: 1, // 默认性别
      timeZone: 2, // 默认时区
      clientOs: "web",
      userId: appleUserData.userId,
      inviteCode: '',
      invite: '',
      address: ''
    };

    this.login(loginData);
  }

  private processLoginResponse(response: InetwarkResponseData) {
    if (response.code === 0) {
      console.log('Login successful');
      this.isLoggedIn = true;
      const loginData = response.data as LoginResponseData;
      localStorage.setItem('token', loginData.token);
      localStorage.setItem('playerId', loginData.player.playerId);
      this.processPendingRequests();
    } else {
      console.error('Login failed:', response.message);
    }
  }

  private processPendingRequests() {
    if (!this.isLoggedIn) return;

    while (this.pendingRequests.length > 0) {
      const request = this.pendingRequests.shift();
      if (request) {
        this.send(request.command, request.data);
      }
    }
  }
}

export const websocketService = new WebSocketService(); 
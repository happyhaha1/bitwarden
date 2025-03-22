<script lang="ts" setup>
import { ref, onMounted, reactive, computed, onUnmounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import BitwandenSettings from '../../components/BitwandenSettings.vue';
import ProgressSpinner from 'primevue/progressspinner';
import Dialog from 'primevue/dialog';
import { useConfirm } from 'primevue/useconfirm';
import { pinyin } from 'pinyin-pro';

const toast = useToast();

defineProps({
  enterAction: {
    type: Object,
    required: true
  }
});

// 设置相关状态
const showSettingsDialog = ref(false);
const settings = ref({
  bwPath: '',
  clientId: '',
  clientSecret: ''
});

// 解锁对话框状态
const showUnlockDialog = ref(false);
const masterPassword = ref('');
const unlockLoading = ref(false);
const sessionKey = ref(''); // 存储会话密钥

// TOTP验证码计时器
const totpTimers = ref({});
const totpCodes = ref({});
const totpCountdowns = ref({});

// 从本地存储加载设置
const loadSettings = () => {
  const savedSettings = window.utools.dbStorage.getItem('bitwarden_settings');
  if (savedSettings) {
    settings.value = JSON.parse(savedSettings);
  }
  
  // 同时加载会话密钥
  const savedSession = window.utools.dbStorage.getItem('bitwarden_session');
  if (savedSession) {
    sessionKey.value = savedSession;
  }
};

// 保存设置到本地存储
const saveSettings = (newSettings) => {
  settings.value = newSettings;
  window.utools.dbStorage.setItem('bitwarden_settings', JSON.stringify(newSettings));
  showSettingsDialog.value = false;
};

// 保存会话密钥到本地存储
const saveSessionKey = (session) => {
  sessionKey.value = session;
  window.utools.dbStorage.setItem('bitwarden_session', session);
};

// Bitwarden原始数据类型
interface BitwardenItem {
  id: string;
  organizationId: string | null;
  folderId: string | null;
  type: number;
  reprompt: number;
  name: string;
  notes: string | null;
  favorite: boolean; // 保留字段以兼容原始数据
  revisionDate: string;
  creationDate: string;
  deletedDate: string | null;
  object: string;
  login?: {
    username: string;
    password: string;
    totp: string | null;
    passwordRevisionDate: string | null;
    uris?: Array<{
      match: any;
      uri: string;
    }>;
    fido2Credentials: any[];
  };
  collectionIds: string[];
}

// 密码项类型定义
interface PasswordItem {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  category: string;
  folderId: string | null;
  hasTOTP: boolean;
  totpCode?: string | null;
  lastModified: Date;
  createdAt: Date;
}

// 密码列表状态
const passwords = ref<PasswordItem[]>([]);
const loading = ref(true);
const searchQuery = ref('');
const selectedPassword = ref<PasswordItem | null>(null);
const showPasswordDialog = ref(false);
const categories = ref(['登录凭证', '信用卡', '身份信息', '安全笔记']);
const filters = ref({
  category: null as string | null,
  folderId: null as string | null
});

// 文件夹
const folders = ref<{id: string, name: string}[]>([
  { id: '3a8e6cbe-fe23-43be-a0e5-f1d9305b9802', name: '网络设备' }
]);

// 表格列配置
const columns = [
  { field: 'title', header: '标题' },
  { field: 'username', header: '用户名' },
  { field: 'category', header: '分类' },
  { field: 'lastModified', header: '最后修改' }
];

// 将Bitwarden数据转换为应用数据结构
const transformBitwardenData = (items: BitwardenItem[]): PasswordItem[] => {
  return items.map(item => {
    // 判断项目类型，1=登录凭证，2=安全笔记，3=信用卡，4=身份信息
    const categoryMap: Record<number, string> = {
      1: '登录凭证',
      2: '安全笔记',
      3: '信用卡',
      4: '身份信息'
    };
    
    return {
      id: item.id,
      title: item.name,
      username: item.login?.username || '',
      password: item.login?.password || '',
      url: item.login?.uris && item.login.uris.length > 0 ? item.login.uris[0].uri : '',
      notes: item.notes || '',
      category: categoryMap[item.type] || '其他',
      folderId: item.folderId,
      hasTOTP: !!item.login?.totp,
      totpCode: item.login?.totp || null,
      lastModified: new Date(item.revisionDate),
      createdAt: new Date(item.creationDate)
    };
  });
};

// 从Bitwarden CLI获取密码
const fetchPasswords = async () => {
  loading.value = true;
  try {
    // 检查是否已配置Bitwarden CLI
    if (!settings.value.bwPath) {
      toast.add({ 
        severity: 'warn', 
        summary: '需要配置', 
        detail: '请先配置Bitwarden CLI路径', 
        life: 3000 
      });
      showSettingsDialog.value = true;
      loading.value = false;
      return;
    }
    
    // 从Bitwarden获取实际密码数据
    const result = await window.services.getBitwardenPasswords(
      settings.value.bwPath,
      settings.value.clientId || null,
      settings.value.clientSecret || null,
      sessionKey.value || null // 传递会话密钥
    );
    
    if (!result.success) {
      // 处理未解锁状态
      if (result.status === 'locked') {
        // 如果使用了保存的会话但会话已过期，清除会话密钥
        if (sessionKey.value) {
          console.log('会话已过期，清除保存的会话密钥');
          window.utools.dbStorage.removeItem('bitwarden_session');
          sessionKey.value = '';
        }
        
        toast.add({ 
          severity: 'info', 
          summary: 'Bitwarden已锁定', 
          detail: '请输入主密码解锁', 
          life: 3000 
        });
        showUnlockDialog.value = true;
        loading.value = false;
        return;
      }
      
      // 处理其他错误
      throw new Error(result.error);
    }
    
    // 处理获取到的文件夹
    folders.value = result.folders.map(folder => ({
      id: folder.id,
      name: folder.name
    }));
    
    // 转换数据结构
    passwords.value = transformBitwardenData(result.items);
    
    toast.add({ 
      severity: 'success', 
      summary: '同步完成', 
      detail: `已获取 ${passwords.value.length} 项密码数据`, 
      life: 2000 
    });
  } catch (error) {
    console.error('获取密码失败:', error);
    
    // 如果错误信息包含会话相关，可能是会话已过期
    if (error.message && (
        error.message.includes('会话') || 
        error.message.includes('session') || 
        error.message.includes('authenticated')
      )) {
      window.utools.dbStorage.removeItem('bitwarden_session');
      sessionKey.value = '';
      showUnlockDialog.value = true;
    }
    
    toast.add({ 
      severity: 'error', 
      summary: '错误', 
      detail: `获取密码失败: ${error.message || '未知错误'}`, 
      life: 3000 
    });
  } finally {
    loading.value = false;
  }
};

// 解锁Bitwarden
const unlockBitwarden = async () => {
  if (!masterPassword.value) {
    toast.add({ 
      severity: 'error', 
      summary: '错误', 
      detail: '请输入主密码', 
      life: 3000 
    });
    return;
  }
  
  unlockLoading.value = true;
  try {
    const result = await window.services.unlockBitwarden(
      settings.value.bwPath,
      masterPassword.value,
      settings.value.clientId || null,
      settings.value.clientSecret || null
    );
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    // 保存会话密钥并持久化存储
    saveSessionKey(result.sessionKey);
    
    // 解锁成功
    toast.add({ 
      severity: 'success', 
      summary: '解锁成功', 
      detail: 'Bitwarden已解锁', 
      life: 2000 
    });
    
    // 关闭解锁对话框
    showUnlockDialog.value = false;
    masterPassword.value = '';
    
    // 获取密码
    fetchPasswords();
  } catch (error) {
    console.error('解锁失败:', error);
    toast.add({ 
      severity: 'error', 
      summary: '解锁失败', 
      detail: `无法解锁Bitwarden: ${error.message || '未知错误'}`, 
      life: 3000 
    });
  } finally {
    unlockLoading.value = false;
  }
};

// 获取文件夹名称
const getFolderName = (folderId: string | null) => {
  if (!folderId) return '未分类';
  const folder = folders.value.find(f => f.id === folderId);
  return folder ? folder.name : '未分类';
};

// 筛选密码
const filteredPasswords = computed(() => {
  return passwords.value.filter(item => {  
    // 搜索筛选
    const matchesSearch = searchQuery.value ? 
      (item.title.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
       item.username.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
       (item.notes && item.notes.toLowerCase().includes(searchQuery.value.toLowerCase())) ||
       // 支持拼音搜索
       pinyin(item.title, { toneType: 'none' }).toLowerCase().includes(searchQuery.value.toLowerCase()) ||
       pinyin(item.title, { pattern: 'first', toneType: 'none' }).toLowerCase().includes(searchQuery.value.toLowerCase()) ||
       (item.notes && pinyin(item.notes, { toneType: 'none' }).toLowerCase().includes(searchQuery.value.toLowerCase()))) : true;
    
    // 分类筛选
    const matchesCategory = filters.value.category ? 
      item.category === filters.value.category : true;
    
    // 文件夹筛选
    const matchesFolder = filters.value.folderId ? 
      item.folderId === filters.value.folderId : true;
    
    return matchesSearch && matchesCategory && matchesFolder;
  });
});

// 复制到剪贴板
const copyToClipboard = (text: string, type: string) => {
  window.utools.copyText(text);
  toast.add({ severity: 'success', summary: '已复制', detail: `${type}已复制到剪贴板`, life: 2000 });
};

// 处理表格行选择
const onRowSelect = (event) => {
  // event.data包含选中的行数据
  const password = event.data;
  selectedPassword.value = password;
  showPasswordDialog.value = true;
  
  // 如果密码项有TOTP，自动生成验证码
  if (password.hasTOTP) {
    generateTOTP(password.id);
  }
};

// 重置筛选
const resetFilters = () => {
  filters.value.category = null;
  filters.value.folderId = null;
  searchQuery.value = '';
};

// 生成TOTP验证码
const generateTOTP = async (id) => {
  try {
    // 找到对应的密码项
    const passwordItem = passwords.value.find(p => p.id === id);
    if (!passwordItem || !passwordItem.hasTOTP) {
      console.warn('无法找到密码项或该项没有TOTP');
      return null;
    }
    
    // 清除旧计时器
    if (totpTimers.value[id]) {
      clearInterval(totpTimers.value[id]);
    }
    
    // 使用Bitwarden CLI生成TOTP验证码
    const result = await window.services.generateTOTP(
      settings.value.bwPath,
      id,
      sessionKey.value
    );
    
    if (!result.success) {
      throw new Error(result.error);
    }
    
    const code = result.code;
    
    // 计算剩余时间
    const now = Math.floor(Date.now() / 1000);
    const countdown = 30 - (now % 30);
    
    // 保存代码和倒计时
    totpCodes.value[id] = code;
    totpCountdowns.value[id] = countdown;
    
    // 设置新计时器
    totpTimers.value[id] = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      const newCountdown = 30 - (now % 30);
      
      // 更新倒计时
      totpCountdowns.value[id] = newCountdown;
      
      // 如果是新的周期，重新生成代码
      if (newCountdown === 29) {
        generateTOTP(id);
      }
      
      // 如果对话框关闭且没有其他地方在使用该验证码，清除计时器
      if (!showPasswordDialog.value) {
        clearInterval(totpTimers.value[id]);
        delete totpTimers.value[id];
      }
    }, 1000);
    
    return code;
  } catch (error) {
    console.error('生成TOTP验证码失败:', error);
    toast.add({ 
      severity: 'error', 
      summary: '错误', 
      detail: `生成验证码失败: ${error.message}`, 
      life: 3000 
    });
    return null;
  }
};

// 复制TOTP验证码
const copyTOTP = async (id) => {
  // 如果没有验证码或正在重新生成中
  if (!totpCodes.value[id]) {
    const code = await generateTOTP(id);
    if (!code) return;
  }
  
  if (totpCodes.value[id]) {
    window.utools.copyText(totpCodes.value[id]);
    toast.add({ 
      severity: 'success', 
      summary: '已复制', 
      detail: `验证码已复制到剪贴板，${totpCountdowns.value[id]}秒后过期`, 
      life: 2000 
    });
  }
};

// 初始化
onMounted(() => {
  window.utools.setSubInput(({ text }) => {
    searchQuery.value = text;
  }, "搜索密码...");
  
  loadSettings();
  fetchPasswords();
  
  // 添加"/"键监听，按下时聚焦到搜索框
  document.addEventListener('keydown', (event) => {
    // 当用户按下"/"键且不在输入框中时
    if (event.key === '/' && 
        !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
      // 阻止默认行为（防止"/"被输入）
      event.preventDefault();
      // 聚焦到搜索框
      window.utools.subInputFocus();
    }
  });
});

// 清理资源
onUnmounted(() => {
  // 清除所有TOTP计时器
  Object.values(totpTimers.value).forEach(timer => clearInterval(timer));
});

// 显示密码详情（用于点击标题时）
const showDetails = (password) => {
  selectedPassword.value = password;
  showPasswordDialog.value = true;
  
  // 如果密码项有TOTP，自动生成验证码
  if (password.hasTOTP) {
    generateTOTP(password.id);
  }
};

// 处理TOTP悬停
const handleTotpHover = (id) => {
  const password = passwords.value.find(p => p.id === id);
  if (password && password.hasTOTP && !totpCodes.value[id]) {
    generateTOTP(id);
  }
};
</script>

<template>
  <Toast />
  
  <div class="password-manager">
    <!-- 顶部工具栏 -->
    <Toolbar class="mb-4">
      <template #start>
        <div class="flex align-items-center">
          <Button icon="pi pi-cog" label="设置" class="mr-2" @click="showSettingsDialog = true" />
          <Button icon="pi pi-sync" label="同步" severity="secondary" @click="fetchPasswords" :loading="loading" />
        </div>
      </template>
      <template #end>
        <div class="flex align-items-center">
          <Dropdown v-model="filters.folderId" :options="folders" optionLabel="name" optionValue="id" 
                   placeholder="选择文件夹" class="mr-2" />
          <Dropdown v-model="filters.category" :options="categories" placeholder="选择分类" class="mr-2" />
          <Button icon="pi pi-filter-slash" text severity="secondary" @click="resetFilters" 
                tooltip="重置筛选" :tooltipOptions="{ position: 'bottom' }" />
        </div>
      </template>
    </Toolbar>

    <!-- 密码列表 -->
    <DataTable :value="filteredPasswords" v-model:selection="selectedPassword" selectionMode="single"
             :loading="loading" @row-select="onRowSelect" class="p-datatable-sm"
             :rows="8" paginator stripedRows removableSort
             @row-dblclick="onRowSelect"
             paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown"
             :rowsPerPageOptions="[8, 15, 30]">
      
      <!-- 标题列 -->
      <Column field="title" header="标题" sortable style="min-width: 12rem">
        <template #body="{ data }">
          <div class="flex align-items-center">
            <Avatar :icon="data.category === '信用卡' ? 'pi pi-credit-card' : 
                        data.category === '安全笔记' ? 'pi pi-file' : 
                        data.category === '身份信息' ? 'pi pi-id-card' : 'pi pi-lock'"
                  :style="{ backgroundColor: 'var(--surface-c)' }" 
                  shape="circle" class="mr-2" />
            <div>
              <div class="cursor-pointer hover:text-primary" @click="showDetails(data)">{{ data.title }}</div>
              <small class="text-color-secondary">{{ getFolderName(data.folderId) }}</small>
            </div>
          </div>
        </template>
      </Column>
      
      <!-- 用户名列 -->
      <Column field="username" header="用户名" sortable>
        <template #body="{ data }">
          <div class="flex align-items-center">
            <span>{{ data.username }}</span>
            <Button icon="pi pi-copy" text rounded size="small"
                  @click.stop="copyToClipboard(data.username, '用户名')"
                  tooltip="复制用户名" :tooltipOptions="{ position: 'bottom' }" />
          </div>
        </template>
      </Column>
      
      <!-- 二次验证列 -->
      <Column field="hasTOTP" header="2FA" style="width: 5rem">
        <template #body="{ data }">
          <div v-if="data.hasTOTP" class="flex align-items-center" @mouseenter="handleTotpHover(data.id)">
            <Badge severity="info" value="2FA" class="mr-2" />
            <Badge v-if="totpCountdowns[data.id]" severity="success" :value="totpCountdowns[data.id] + 's'" />
          </div>
        </template>
      </Column>
      
      <!-- 分类列 -->
      <Column field="category" header="分类" sortable style="width: 10rem">
        <template #body="{ data }">
          <Tag :value="data.category" 
              :severity="data.category === '登录凭证' ? 'info' : 
                        data.category === '信用卡' ? 'warning' : 
                        data.category === '身份信息' ? 'danger' : 'success'" />
        </template>
      </Column>
      
      <!-- 操作列 -->
      <Column header="操作" style="width: 10rem">
        <template #body="{ data }">
          <div class="flex gap-2 justify-content-center">
            <Button icon="pi pi-copy" text rounded
                  @click.stop="copyToClipboard(data.password, '密码')"
                  tooltip="复制密码" :tooltipOptions="{ position: 'bottom' }" />
            <Button v-if="data.hasTOTP" icon="pi pi-key" text rounded severity="success"
                  @click.stop="copyTOTP(data.id)"
                  tooltip="复制验证码" :tooltipOptions="{ position: 'bottom' }" />
            <Button icon="pi pi-info-circle" text rounded severity="info"
                  @click.stop="showDetails(data)"
                  tooltip="查看详情" :tooltipOptions="{ position: 'bottom' }" />
          </div>
        </template>
      </Column>
      
      <!-- 空状态 -->
      <template #empty>
        <div class="flex flex-column align-items-center p-5">
          <i class="pi pi-lock-open text-5xl mb-4 text-color-secondary"></i>
          <span v-if="loading">正在加载密码数据...</span>
          <span v-else>没有找到密码项</span>
          <Button v-if="!loading && (searchQuery || filters.category || filters.folderId)"
                label="清除所有筛选器" class="mt-3 p-button-outlined" @click="resetFilters" />
        </div>
      </template>
    </DataTable>
    
    <!-- 密码详情对话框 -->
    <Dialog v-model:visible="showPasswordDialog" modal header="密码详情" 
          :style="{ width: '50rem' }" :closable="true" :closeOnEscape="true">
      <div v-if="selectedPassword" class="password-details">
        <div class="flex mb-4">
          <Avatar :icon="selectedPassword.category === '信用卡' ? 'pi pi-credit-card' : 
                      selectedPassword.category === '安全笔记' ? 'pi pi-file' : 
                      selectedPassword.category === '身份信息' ? 'pi pi-id-card' : 'pi pi-lock'"
                :style="{ backgroundColor: 'var(--surface-c)' }" 
                size="xlarge" shape="circle" class="mr-4" />
          <div class="flex-1">
            <h2 class="m-0 mb-2">{{ selectedPassword.title }}</h2>
            <div class="flex align-items-center gap-2">
              <Tag :value="selectedPassword.category" 
                  :severity="selectedPassword.category === '登录凭证' ? 'info' : 
                            selectedPassword.category === '信用卡' ? 'warning' : 
                            selectedPassword.category === '身份信息' ? 'danger' : 'success'" />
              <Tag v-if="selectedPassword.folderId" severity="secondary">
                {{ getFolderName(selectedPassword.folderId) }}
              </Tag>
              <Badge v-if="selectedPassword.hasTOTP" severity="info" value="二步验证" />
            </div>
          </div>
        </div>
        
        <Divider />
        
        <div class="grid">
          <div class="col-12 md:col-6 mb-4">
            <label class="block text-sm mb-1">用户名</label>
            <InputGroup>
              <InputText :value="selectedPassword.username" readonly class="w-full" />
              <Button icon="pi pi-copy" @click="copyToClipboard(selectedPassword.username, '用户名')" />
            </InputGroup>
          </div>
          
          <div class="col-12 md:col-6 mb-4">
            <label class="block text-sm mb-1">密码</label>
            <InputGroup>
              <Password v-model="selectedPassword.password" :feedback="false" toggleMask readonly inputClass="w-full" />
              <Button icon="pi pi-copy" @click="copyToClipboard(selectedPassword.password, '密码')" />
            </InputGroup>
          </div>
          
          <div class="col-12 mb-4" v-if="selectedPassword.url">
            <label class="block text-sm mb-1">网址</label>
            <InputGroup>
              <InputText :value="selectedPassword.url" readonly class="w-full" />
              <Button icon="pi pi-copy" @click="copyToClipboard(selectedPassword.url, '网址')" />
              <Button icon="pi pi-external-link" @click="window.utools.shellOpenExternal(selectedPassword.url)" />
            </InputGroup>
          </div>
          
          <div class="col-12 mb-4" v-if="selectedPassword.notes">
            <label class="block text-sm mb-1">备注</label>
            <Textarea :value="selectedPassword.notes" readonly rows="3" class="w-full" />
          </div>
          
          <div class="col-12 mb-4" v-if="selectedPassword.hasTOTP">
            <label class="block text-sm mb-1">二步验证码</label>
            <InputGroup>
              <InputText :value="totpCodes[selectedPassword.id] || '加载中...'" readonly class="w-full font-bold text-2xl text-center" />
              <InputGroupAddon>
                <Button icon="pi pi-copy" @click="copyTOTP(selectedPassword.id)" />
                <Button v-if="totpCountdowns[selectedPassword.id]" class="p-button-warning">
                  {{ totpCountdowns[selectedPassword.id] }}s
                </Button>
              </InputGroupAddon>
            </InputGroup>
            <small v-if="!totpCodes[selectedPassword.id]" class="block mt-2 text-color-secondary">
              点击按钮生成并复制验证码
            </small>
          </div>
        </div>
        
        <Divider />
        
        <div class="flex justify-content-between">
          <span class="text-color-secondary text-sm">
            创建于: {{ selectedPassword.createdAt.toLocaleDateString() }} | 
            修改于: {{ selectedPassword.lastModified.toLocaleDateString() }}
          </span>
          <div>
            <Button icon="pi pi-pencil" label="编辑" class="mr-2" severity="secondary" />
            <Button icon="pi pi-trash" label="删除" severity="danger" />
          </div>
        </div>
      </div>
    </Dialog>
    
    <!-- Bitwarden设置对话框 -->
    <BitwandenSettings
      :visible="showSettingsDialog"
      :settings="settings"
      @close="showSettingsDialog = false"
      @update:visible="showSettingsDialog = $event"
      @save="saveSettings"
    />

    <!-- Bitwarden解锁对话框 -->
    <Dialog
      :visible="showUnlockDialog"
      @update:visible="showUnlockDialog = $event"
      modal
      header="解锁 Bitwarden"
      :style="{ width: '400px' }"
      :closable="true"
      :closeOnEscape="true"
    >
      <div class="p-fluid">
        <div class="field">
          <label for="master-password" class="font-bold mb-2 block">请输入主密码解锁保管库</label>
          <InputGroup>
            <InputGroupAddon>
              <i class="pi pi-lock"></i>
            </InputGroupAddon>
            <Password
              id="master-password"
              v-model="masterPassword"
              placeholder="输入Bitwarden主密码"
              :feedback="false"
              toggleMask
              inputClass="w-full"
              @keydown.enter="unlockBitwarden"
            />
          </InputGroup>
          <small class="text-color-secondary block mt-2">
            登录后的会话将会保存，下次打开时自动使用
          </small>
        </div>
      </div>
      
      <template #footer>
        <Button
          label="取消"
          icon="pi pi-times"
          @click="showUnlockDialog = false"
          class="p-button-text"
        />
        <Button
          label="解锁"
          icon="pi pi-unlock"
          @click="unlockBitwarden"
          :loading="unlockLoading"
        />
      </template>
    </Dialog>
  </div>
</template>

<style scoped>
.password-manager {
  padding: 1.5rem;
  height: 100%;
}

.p-datatable {
  border-radius: 8px;
  overflow: hidden;
}

:deep(.p-inputtext), :deep(.p-dropdown) {
  border-radius: 6px;
}

:deep(.p-button) {
  border-radius: 6px;
}

:deep(.p-datatable .p-datatable-tbody > tr) {
  cursor: pointer;
  transition: background-color 0.2s;
}

:deep(.p-datatable .p-datatable-tbody > tr:hover) {
  background-color: var(--surface-hover);
}
</style>

<script lang="ts" setup>
import { ref, defineEmits, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import InputGroup from 'primevue/inputgroup';
import InputGroupAddon from 'primevue/inputgroupaddon';

const toast = useToast();
const emit = defineEmits(['close', 'save', 'update:visible']);

const props = defineProps({
  visible: {
    type: Boolean,
    required: true
  },
  settings: {
    type: Object,
    required: true,
    default: () => ({
      bwPath: '',
      clientId: '',
      clientSecret: ''
    })
  }
});

// 更新visible属性
const updateVisible = (value: boolean) => {
  emit('update:visible', value);
};

// 本地设置状态
const localSettings = ref({
  bwPath: '',
  clientId: '',
  clientSecret: ''
});

// 监听visible变化，当对话框打开时，更新本地设置数据
watch(() => props.visible, (newValue) => {
  if (newValue) {
    // 对话框打开时，更新本地设置为最新的props值
    localSettings.value = {
      bwPath: props.settings.bwPath || '',
      clientId: props.settings.clientId || '',
      clientSecret: props.settings.clientSecret || ''
    };
  }
});

// 监听settings变化
watch(() => props.settings, (newSettings) => {
  if (props.visible) {
    // 如果对话框已打开，则更新本地设置
    localSettings.value = {
      bwPath: newSettings.bwPath || '',
      clientId: newSettings.clientId || '',
      clientSecret: newSettings.clientSecret || ''
    };
  }
}, { deep: true });

// 校验设置
const validateSettings = () => {
  if (!localSettings.value.bwPath) {
    toast.add({ severity: 'error', summary: '错误', detail: 'Bitwarden CLI路径不能为空', life: 3000 });
    return false;
  }
  return true;
};

// 保存设置
const saveSettings = () => {
  if (!validateSettings()) return;
  
  emit('save', { ...localSettings.value });
  toast.add({ 
    severity: 'success', 
    summary: '已保存', 
    detail: '设置已保存', 
    life: 2000 
  });
};

// 浏览文件
const browseBwPath = () => {
  window.utools.showOpenDialog({
    title: '选择Bitwarden CLI可执行文件',
    filters: [{ name: 'Executable', extensions: ['*'] }],
    properties: ['openFile'] 
  }, (filePaths) => {
    if (filePaths && filePaths.length > 0) {
      localSettings.value.bwPath = filePaths[0];
    }
  });
};

// 测试连接
const testConnection = async () => {
  if (!validateSettings()) return;
  
  toast.add({ 
    severity: 'info', 
    summary: '测试中', 
    detail: '正在测试Bitwarden CLI连接...', 
    life: 3000 
  });
  
  try {
    // 使用预加载的服务测试连接
    const result = await window.services.testBitwardenConnection(
      localSettings.value.bwPath,
      localSettings.value.clientId || null,
      localSettings.value.clientSecret || null
    );
    
    // 显示成功消息
    if (result.success) {
      toast.add({ 
        severity: 'success', 
        summary: '连接成功', 
        detail: `Bitwarden CLI 版本: ${result.version}`, 
        life: 3000 
      });
      
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('测试连接错误:', error);
    toast.add({ 
      severity: 'error', 
      summary: '连接失败', 
      detail: `无法连接到Bitwarden CLI: ${error.message || '未知错误'}`, 
      life: 5000 
    });
  }
};
</script>

<template>
  <Dialog 
    :visible="visible" 
    @update:visible="updateVisible"
    modal 
    header="Bitwarden 设置" 
    :style="{ width: '550px' }" 
    :closable="true" 
    :closeOnEscape="true"
    @hide="$emit('close')"
  >
    <div class="p-fluid p-3">
      <div class="field mb-4">
        <div class="flex align-items-center mb-2">
          <i class="pi pi-cog text-primary mr-2"></i>
          <label for="bw-path" class="font-bold">Bitwarden CLI路径</label>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <i class="pi pi-file-o"></i>
          </InputGroupAddon>
          <InputText 
            id="bw-path" 
            v-model="localSettings.bwPath" 
            placeholder="输入或选择Bitwarden CLI可执行文件路径" 
          />
          <Button icon="pi pi-folder-open" @click="browseBwPath" />
        </InputGroup>
        <small class="block mt-2 text-color-secondary">
          <i class="pi pi-info-circle mr-1"></i>
          Bitwarden CLI通常安装在 /usr/local/bin/bw 或 ~/.npm/bin/bw
        </small>
      </div>
      
      <div class="field mb-4">
        <div class="flex align-items-center mb-2">
          <i class="pi pi-id-card text-primary mr-2"></i>
          <label for="client-id" class="font-bold">API客户端ID <span class="text-color-secondary">(可选)</span></label>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <i class="pi pi-user"></i>
          </InputGroupAddon>
          <InputText 
            id="client-id" 
            v-model="localSettings.clientId" 
            placeholder="输入Bitwarden API客户端ID"
          />
        </InputGroup>
        <small class="block mt-2 text-color-secondary">
          <i class="pi pi-info-circle mr-1"></i>
          仅企业版Bitwarden需要此设置
        </small>
      </div>
      
      <div class="field mb-4">
        <div class="flex align-items-center mb-2">
          <i class="pi pi-key text-primary mr-2"></i>
          <label for="client-secret" class="font-bold">API客户端密钥 <span class="text-color-secondary">(可选)</span></label>
        </div>
        <InputGroup>
          <InputGroupAddon>
            <i class="pi pi-lock"></i>
          </InputGroupAddon>
          <Password 
            id="client-secret" 
            v-model="localSettings.clientSecret" 
            placeholder="输入Bitwarden API客户端密钥" 
            :feedback="false"
            toggleMask
            inputClass="w-full"
          />
        </InputGroup>
        <small class="block mt-2 text-color-secondary">
          <i class="pi pi-info-circle mr-1"></i>
          仅企业版Bitwarden需要此设置
        </small>
      </div>
      
      <Divider />
      
      <div class="flex justify-content-between">
        <Button 
          label="测试连接" 
          icon="pi pi-check-circle" 
          severity="info" 
          @click="testConnection"
          class="p-button-rounded"
        />
        <div>
          <Button 
            label="取消" 
            icon="pi pi-times" 
            severity="secondary" 
            outlined 
            class="mr-2 p-button-rounded" 
            @click="updateVisible(false)" 
          />
          <Button 
            label="保存" 
            icon="pi pi-save" 
            severity="primary" 
            @click="saveSettings"
            class="p-button-rounded" 
          />
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
:deep(.p-button) {
  border-radius: 8px;
}

:deep(.p-password-input) {
  width: 100%;
}

:deep(.p-inputgroup-addon) {
  background-color: var(--surface-200);
  color: var(--primary-color);
  border-color: var(--surface-300);
  min-width: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.p-inputgroup .p-component) {
  border-radius: 0;
}

:deep(.p-inputgroup .p-inputgroup-addon:first-child) {
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
}

:deep(.p-inputgroup .p-button:last-child) {
  border-top-right-radius: 6px;
  border-bottom-right-radius: 6px;
}

.text-primary {
  color: var(--primary-color);
}
</style>
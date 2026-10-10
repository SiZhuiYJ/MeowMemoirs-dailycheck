# 认证组件文档

## 组件结构

将原来的单一 `index.vue` 文件拆分为多个职责明确的小组件：

### 基础输入组件
- **EmailInput.vue** - 邮箱输入组件
- **AccountInput.vue** - 账号输入组件（支持错误提示和后缀插槽）
- **PasswordInput.vue** - 密码输入组件（支持确认密码模式）
- **VerificationCodeInput.vue** - 验证码输入组件（包含倒计时功能）

### 功能组件
- **AuthTabs.vue** - 登录/注册标签切换组件
- **LoginMethods.vue** - 登录方式选择组件（邮箱/账号）
- **LoginForm.vue** - 登录表单组件（整合登录相关输入）
- **RegisterForm.vue** - 注册表单组件（整合注册相关输入）

### 主组件
- **index.vue** - 主认证页面组件（组合使用上述组件）

## 使用示例

### 基本导入方式
```typescript
import { 
  AuthTabs, 
  LoginForm, 
  RegisterForm,
  EmailInput,
  AccountInput,
  PasswordInput,
  VerificationCodeInput
} from '@/features/auth/components'
```

### 单独导入
```typescript
import AuthTabs from '@/features/auth/components/AuthTabs.vue'
import LoginForm from '@/features/auth/components/LoginForm.vue'
```

## 组件职责说明

### 输入组件特点
- 使用标准的 `v-model` 双向绑定模式
- 支持 `required` 属性
- 提供默认占位符文本
- 统一的样式和交互体验

### ⚠️ 重要提醒

由于 Vue 的限制，**props 不能直接使用 v-model**。在自定义组件中：

❌ 错误写法：
```vue
<input v-model="propValue" />
```

✅ 正确写法：
```vue
<input 
  :value="propValue" 
  @input="$emit('update:modelValue', $event.target.value)"
/>
```

所有基础输入组件都已经正确实现了这一模式。

### 表单组件特点
- 处理表单提交逻辑
- 内部管理加载状态
- 通过 `defineExpose` 暴露 setLoading 方法供父组件控制
- 发送具体的业务事件给父组件处理

### 组合使用
主组件 `index.vue` 负责：
- 状态管理（登录/注册模式切换）
- 业务逻辑处理（API调用、错误处理）
- 组件间协调通信

## 样式说明
- 所有组件使用统一的 CSS 变量主题
- 响应式设计适配移动端
- 继承父组件的样式作用域

## 测试文件
- `test-page.vue` - 完整功能测试页面
- `component-demo.vue` - 各组件独立演示页面

可以在开发环境中导入这些测试文件来验证组件功能。
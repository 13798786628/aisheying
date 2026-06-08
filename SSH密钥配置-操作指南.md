# 📋 SSH 密钥配置 - 复制这些命令

## 你的公钥（已生成）
```
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC3sHT1IPpf4aMZIDDv3rs5es0v+0DDWy6ihWnpw3PrYPO4bp/UyzApGDN2hXDFW016FO+IaJ+sHFwWCnFLKf71qmmI88Ikjua/RIi6z/2xyVeoMi5OZQIg04pE79UZNGuu4yelXimeqKAbbq086zIExyIuMs6oPlj7YPL79b2JIGIJR7MfsirHfhRDhu0V4WTFM6fMkkQ2nkIrMpl05TpWMJhehl5uPasoGTAa7qyo2Kw+Yckmk7EN1BQpEoUfupv4g6sxhbcafixaNT8/yyDORTo8GdDZXQc3/jC0QFxMRPXSgsspWexNVxRq6MwVOS4ACJi887049u37CsR5eUhHlwPqfisPFl7jOCGSFPsdTcZeGrw6yfPWtqDHbaevLthcZD1y477ejNiT2fE0SzI5cAp9iDNYgCstTRAIW3I+adyQoZyyv8y7DxA02foXbXnA+Izwcjao+JJg0yPbpcvFoH0j+m+sAMmS5T+pG9PYdugNnhFgfcKHqx8FQRXRX4BaxGGnTSgguc1FlF0aB1ZPGOK/LRlBCua8ZZxJgdOf6kp9+fNosHjDoWh4H9qeRZ059syBkstm5U8oSvH3JF32OTWB6fffMYAnogzrOey6AaOleAA3cbBrd7MJs8fIfRVAP0l8QER7Tl1pEpO9W95KRYixw92fXOZAwXS+yp8iBw== 22591@zjj
```

---

## 🎯 立即执行（3个步骤）

### 步骤 1：打开新终端窗口，SSH 登录服务器（需要扫码）

```bash
ssh root@106.53.167.63
```

**微信扫码登录**（这是最后一次需要扫码）

---

### 步骤 2：在服务器上配置公钥（服务器端执行）

登录成功后，在服务器上依次执行：

```bash
# 创建 .ssh 目录
mkdir -p ~/.ssh && chmod 700 ~/.ssh

# 添加公钥（一条命令）
echo 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC3sHT1IPpf4aMZIDDv3rs5es0v+0DDWy6ihWnpw3PrYPO4bp/UyzApGDN2hXDFW016FO+IaJ+sHFwWCnFLKf71qmmI88Ikjua/RIi6z/2xyVeoMi5OZQIg04pE79UZNGuu4yelXimeqKAbbq086zIExyIuMs6oPlj7YPL79b2JIGIJR7MfsirHfhRDhu0V4WTFM6fMkkQ2nkIrMpl05TpWMJhehl5uPasoGTAa7qyo2Kw+Yckmk7EN1BQpEoUfupv4g6sxhbcafixaNT8/yyDORTo8GdDZXQc3/jC0QFxMRPXSgsspWexNVxRq6MwVOS4ACJi887049u37CsR5eUhHlwPqfisPFl7jOCGSFPsdTcZeGrw6yfPWtqDHbaevLthcZD1y477ejNiT2fE0SzI5cAp9iDNYgCstTRAIW3I+adyQoZyyv8y7DxA02foXbXnA+Izwcjao+JJg0yPbpcvFoH0j+m+sAMmS5T+pG9PYdugNnhFgfcKHqx8FQRXRX4BaxGGnTSgguc1FlF0aB1ZPGOK/LRlBCua8ZZxJgdOf6kp9+fNosHjDoWh4H9qeRZ059syBkstm5U8oSvH3JF32OTWB6fffMYAnogzrOey6AaOleAA3cbBrd7MJs8fIfRVAP0l8QER7Tl1pEpO9W95KRYixw92fXOZAwXS+yp8iBw== 22591@zjj' >> ~/.ssh/authorized_keys

# 设置权限
chmod 600 ~/.ssh/authorized_keys

# 验证配置
cat ~/.ssh/authorized_keys

# 退出服务器
exit
```

---

### 步骤 3：测试密钥登录（本地执行）

回到你的本地终端，测试密钥登录：

```bash
ssh -i ~/.ssh/wedscene_rsa root@106.53.167.63
```

**如果成功：**
- ✅ 直接登录，不需要密码
- ✅ 不需要扫码
- ✅ 立即登录成功

**如果成功了，输入 `exit` 退出，然后运行部署脚本：**

```bash
exit
cd "C:\Users\22591\Desktop\婚礼ai视频"
bash 快速部署-106.53.167.63-密钥版.sh
```

---

## 🚀 自动化脚本（配置完成后使用）

配置好密钥后，可以使用这个脚本：

```bash
bash 配置SSH密钥.sh
```

这个脚本会：
- ✅ 显示你的公钥
- ✅ 提供配置命令
- ✅ 测试连接
- ✅ 确认配置成功

---

## ⚡ 快速命令（按顺序执行）

### 1. 登录服务器（新终端窗口）
```bash
ssh root@106.53.167.63
```
**微信扫码**

### 2. 在服务器执行（一次性复制执行）
```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQC3sHT1IPpf4aMZIDDv3rs5es0v+0DDWy6ihWnpw3PrYPO4bp/UyzApGDN2hXDFW016FO+IaJ+sHFwWCnFLKf71qmmI88Ikjua/RIi6z/2xyVeoMi5OZQIg04pE79UZNGuu4yelXimeqKAbbq086zIExyIuMs6oPlj7YPL79b2JIGIJR7MfsirHfhRDhu0V4WTFM6fMkkQ2nkIrMpl05TpWMJhehl5uPasoGTAa7qyo2Kw+Yckmk7EN1BQpEoUfupv4g6sxhbcafixaNT8/yyDORTo8GdDZXQc3/jC0QFxMRPXSgsspWexNVxRq6MwVOS4ACJi887049u37CsR5eUhHlwPqfisPFl7jOCGSFPsdTcZeGrw6yfPWtqDHbaevLthcZD1y477ejNiT2fE0SzI5cAp9iDNYgCstTRAIW3I+adyQoZyyv8y7DxA02foXbXnA+Izwcjao+JJg0yPbpcvFoH0j+m+sAMmS5T+pG9PYdugNnhFgfcKHqx8FQRXRX4BaxGGnTSgguc1FlF0aB1ZPGOK/LRlBCua8ZZxJgdOf6kp9+fNosHjDoWh4H9qeRZ059syBkstm5U8oSvH3JF32OTWB6fffMYAnogzrOey6AaOleAA3cbBrd7MJs8fIfRVAP0l8QER7Tl1pEpO9W95KRYixw92fXOZAwXS+yp8iBw== 22591@zjj' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && exit
```

### 3. 测试连接（本地）
```bash
ssh -i ~/.ssh/wedscene_rsa root@106.53.167.63
```

### 4. 开始部署（本地）
```bash
exit
cd "C:\Users\22591\Desktop\婚礼ai视频"
bash 快速部署-106.53.167.63-密钥版.sh
```

---

## 📝 注意事项

- ⚠️ 公钥内容必须**完整复制**（从 `ssh-rsa` 到最后）
- ⚠️ 服务器端命令需要在**服务器上执行**，不是本地
- ⚠️ 权限设置很重要：`chmod 700 ~/.ssh` 和 `chmod 600 ~/.ssh/authorized_keys`

---

**准备好了吗？现在就开始执行步骤 1！** 🚀

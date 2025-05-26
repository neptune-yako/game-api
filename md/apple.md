### 3.4 网页的html中配置

如果要使用service id中的return urls，那就需要服务端提供post接口。如果不用服务端，只用前端介入的话，可以使用pop up的弹出窗口模式。

> 如果使用pop up方式，那么在Facebook等第三方app中显示网页时，授权弹窗会被阻止，导致流程中断，切记

在html中配置script脚本

```html
<script type="text/javascript" src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"></script>
```

使用js或者ts脚本

```js
AppleID.auth.init({
      clientId : '[CLIENT_ID]',
      scope : '[SCOPES]', // 比如[ 'name', 'email' ]
      redirectURI : '[REDIRECT_URI]',
      state : '[STATE]',
      nonce : '[NONCE]',
      usePopup : true // 这里如果是true，那么就是使用弹窗授权, return urls就用不到
});

// 直接使用promise的方式，当然也有使用document监听的
AppleID.auth.signIn()
.then(res => {
  
})
.catch(err => {
  
});

// 可选，document监听
// Listen for authorization success.
document.addEventListener('AppleIDSignInOnSuccess', (event) => {
    // Handle successful response.
    console.log(event.detail.data);
});


// Listen for authorization failures.
document.addEventListener('AppleIDSignInOnFailure', (event) => {
     // Handle error.
     console.log(event.detail.error);
});
```

使用signin方法得到的数据就是包括code、id_token参数的res，将这2个参数传给自己公司的接口，让服务端去从Apple端获取用户信息。



## 四、服务端所需的资料

- Apple开发者账号的team id
- Apple开发者账号的service id
- Apple开发者账号的key文件（p8文件）
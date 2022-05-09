## 配置方式

1. `npm install`

2. `npm audit fix`（可选，用于修复一些 vulnerabilities）

   > 如果此时接着执行 npm start 会提示 `'PORT' is not recognized as an internal or external command`，因此需要先按照第三步修改

3. 修改 `package.json`：添加 PORT 设置

   ```json
     "scripts": {
   ...
       "start": "set PORT=3113 && razzle start",
   ...
     },
   
   ```

4. `npm start`

> 服务器刚启动后，需要从新到旧获取历史价格（获取速度因为调用限制不能太快），因此建议等待数分钟后才开始进行 api 请求。（可以从命令行上的输出看目前已经获取到第几天的数据）



## 使用方式

例子：`http://localhost:3113/api/candles/ETH?preferableChainId=56&period=1h&from=1650234954&to=1650378658&preferableSource=chainlink`

1. `http://localhost:3113/api/candles`：表示 api 地址
2. `ETH`: token symbol，目前合法的有 `BNB, BTC, ETH`
3. `preferableChainId=56`: 目前只支持 BSC mainnet/testnet，均以 `56` 表示（为了可能会增加其他链） 
4. `period=1h`：有如下 6 种时间粒度，从`src/routes.js`可以看到：

```javascript
const periodsMap = {
  '5m': 60 * 5,
  '15m': 60 * 15,
  '1h': 60 * 60,
  '4h': 60 * 60 * 4,
  '1d': 60 * 60 * 24,
  '1w': 60 * 60 * 24 * 7
}
```

5. `from=1650234954&to=1650378658`：以 unix timestamp 表示的时间，表示获取 from ~ to 时间段内的价格

6. (固定不变)`preferableSource=chainlink`：表示以 chainlink 作为价格的来源



## 相关的源代码

1. `src/routes.js`：
   - 涉及 api 的处理
   - 调用 `chainlinkFetcher`里的函数获取价格，并保存在 `cachedPrices`
2. `src/chainlinkFetcher.js`：
   - 包含实际从 chainlink 获取价格的函数
3. `src/chainlinkAddr.js`：
   - 包含 chainlink 获取价格的合约地址、token 地址（BSC mainnet/testnet）



## 其他

1. 主网和测试网的切换：

​	在 `.env` 里，将`ENABLE_MAINNET`设为 true 表示使用 BSC mainnet，设为 false 表示使用 BSC testnet。目前暂不支持 mainnet & testnet 同时使用，同一时间只能使用其中一种。

2. `cachedPrices`的持久化保存与恢复：

   - 目的：方便服务器崩溃后重启可以及时恢复数据，而不用担心之前获取的数据都不见了

   - 在 `src/routes.js`中新增了 `saveCachedPrices2Json(), restoreCachedPricesFromJson()`
   - `saveCachedPrices2Json()`：目前设定为每 20 分钟将 `cachedPrices` 持久化保存为 `json`，存于`/chainlink_cache/prices_mainnet.json`（testnet则是`prices_testnet.json`）
   - `restoreCachedPricesFromJson()`：每次启动服务器后，就预先尝试根据当前为 mainnet/testnet 从上述 `json`文件自动加载数据到 `cachedPrices`


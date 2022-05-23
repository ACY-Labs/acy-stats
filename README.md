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
   - 从 subgraph 获取价格，并保存在数据库中
2. `src/chainlinkAddr.js`：包含 token 地址

3. 数据库相关：
   1. `database.js`：定义了 sqlite 的连接方式及数据库保存的地方
   2. `PricesModel.js`：定义了有关价格的 table

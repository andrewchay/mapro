# 蒲公英搜索 API Payload 参考

## 小红书蒲公英 Payload

博客搜索接口 `https://pgy.xiaohongshu.com/api/solar/cooperator/blogger/v2` 的完整 POST payload。

所有字段都必须保留（包括空数组和默认值），否则可能触发风控。

```python
payload = {
    "searchType": 1,           # 搜索类型：1=KOL搜索
    "column": "comprehensiverank",  # 排序列：综合排序
    "sort": "desc",            # 排序方向
    "pageNum": 1,              # 页码
    "pageSize": 20,            # 每页数量
    "brandUserId": "xxx",      # 品牌用户ID
    "trackId": f"kolMatch_{uuid.uuid4().hex}",  # 追踪ID
    "keyword": None,           # 关键词
    "gender": "女",            # 性别：男/女
    "location": ["中国 深圳", "中国 广州"],  # 博主地域（format_location_cities 格式化后）
    "signed": -1,              # 签约状态：-1=不限
    "featureTags": [],         # 擅长标签
    "fansAge": 0,              # 粉丝年龄：0=不限
    "fansGender": 0,           # 粉丝性别：0=不限
    "fansLocation": ["中国 深圳", "中国 广州"],  # 粉丝地域
    "fansMaritalStatus": -1,   # 粉丝婚恋状态：-1=不限
    "fansConsumptionLevel": -1, # 粉丝消费水平：-1=不限
    "fansChildAgeInfo": [],    # 粉丝子女年龄
    "fansDevicePrice": [],     # 粉丝手机价格
    "fansDeviceBrand": [],     # 粉丝手机品牌
    "accumCommonImpMedinNum30d": [],  # 近30天曝光中位数
    "readMidNor30": [],        # 近30天阅读中位数
    "interMidNor30": [],       # 近30天互动中位数
    "thousandLikePercent30": [],  # 近30天千赞率
    "noteType": 0,             # 笔记类型：0=不限
    "notePriceLower": 1000,    # 合作报价下限（元）
    "notePriceUpper": 5000,    # 合作报价上限（元）
    "fansNumberLower": 2000,   # 粉丝量下限
    "fansNumberUpper": 100000, # 粉丝量上限
    "progressOrderCnt": [],    # 进行中订单数
    "tradeType": "美妆个护",   # 交易类型/内容类目
    "tradeReportBrandIdSet": [],  # 排除品牌ID集合
    "excludedTradeReportBrandId": False,  # 是否排除合作品牌
    "estimateCpuv30d": [],     # 预估CPUV
    "inStar": 0,               # 是否星级达人
    "firstIndustry": "",       # 一级行业
    "secondIndustry": "",      # 二级行业
    "newHighQuality": 0,       # 新优质达人
    "filterIntention": False,  # 筛选意向
    "flagList": [              # 标记列表
        {"flagType": "HAS_BRAND_COOP_BUYER_AUTH", "flagValue": "0"},
        {"flagType": "IS_HIGH_QUALITY", "flagValue": "0"}
    ],
    "activityCodes": [],       # 活动编码
    "excludeLowActive": False, # 排除低活跃
    "fansNumUp": 0,            # 粉丝增长
    "excludedTradeReportBrand": False,  # 排除已合作品牌
    "excludedTradeInviteReportBrand": False,  # 排除已邀约品牌
    "filterList": [],          # 筛选列表
    "contentSceneLabel": [],   # 内容场景标签
}
```

### 动态替换字段（小红书）

| 字段 | 对应配置 | 说明 |
|------|---------|------|
| `brandUserId` | `cfg["brand_user_id"]` | 品牌用户ID，固定值 |
| `keyword` | `cfg["keyword"]` 或 None | 搜索关键词 |
| `gender` | `cfg["gender"]` | "男"或"女" |
| `location` | `format_location_cities(cfg["location_cities"])` | 博主地域列表 |
| `fansLocation` | `format_location_cities(cfg["fans_location_cities"])` | 粉丝地域列表 |
| `notePriceLower` | `cfg["note_price_lower"]` | 报价下限（元） |
| `notePriceUpper` | `cfg["note_price_upper"]` | 报价上限（元） |
| `fansNumberLower` | `cfg["fans_number_lower"]` | 粉丝量下限 |
| `fansNumberUpper` | `cfg["fans_number_upper"]` | 粉丝量上限 |
| `tradeType` | `cfg["trade_type"]` | 交易类型 |

### 接口说明

- **方法**: POST
- **Content-Type**: application/json
- **认证**: 浏览器自动带 Cookie（无需手动处理）
- **调用方式**: `page.evaluate(js_fetch_json(url, method="POST", body=payload))`
- **翻页**: 递增 `pageNum`，直到返回为空或达到 `max_pages`

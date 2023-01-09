<a href="https://aimeos.org/">
    <img src="img/telebirrlogo.png" alt="Telebirr" title="Aimeos" align="right" height="60" />
</a>

# telebirr-js

![](img/telebanner.png)

![GitHub branch checks state](https://img.shields.io/github/checks-status/MelakuDemeke/telebirr-js/main)
![GitHub repo size](https://img.shields.io/github/repo-size/MelakuDemeke/telebirr-js)
![GitHub issues](https://img.shields.io/github/issues/MelakuDemeke/telebirr-js)
![GitHub Repo stars](https://img.shields.io/github/stars/MelakuDemeke/telebirr-js?logo=github&style=flat)
![GitHub forks](https://img.shields.io/github/forks/MelakuDemeke/telebirr-js?logo=github&style=falt)
![GitHub commit activity](https://img.shields.io/github/commit-activity/m/MelakuDemeke/telebirr-js?logo=github)
![GitHub last commit](https://img.shields.io/github/last-commit/MelakuDemeke/telebirr-js)

telebirr-js is a Nodejs library for [telebirr](https://www.ethiotelecom.et/telebirr/).  
Telebirr is a mobile money service developed by Huawei that is owned and was launched by Ethio telecom.  
This library will help you by providing an easy integration method so you can focus on your main task

## Table of content
- [telebirr-js](#telebirr-js)
  - [Table of content](#table-of-content)
  - [Installation](#installation)
    - [npm](#npm)
  - [Usage](#usage)
    - [Required information's](#required-informations)
    - [General setup](#general-setup)
    - [To initialize payment](#to-initialize-payment)

## Installation
### npm
```
npm i telebirr-js
```

## Usage
### Required information's
you will receive the required information from Tele with information which looks like theis :arrow_down:

| merchant name   | short code   |  APP ID | APP KEY  |  Public ID | H5  | InApp Payment   |
|---|---|---|---|---|---|---|
| owner name  | 6-digit code  | 32-character Id  | 32-character key  | 392-character public key  | web payment url  | mobile payment url  |

you should store those information in your development environment like `.env` file

### General setup
you should always require telebirr-js
```javascript
const Telebirr = require('telebirr-js')
```
### To initialize payment

/**
 * client.js —— 设置 → 她（浏览器半边）
 *
 * 形态：一个 settings.section，内部自带页签（状态 / 登录 / 记忆 / 成长 / 手）。
 * 数据：同源 fetch /dsh-herself/api/*（App 内自带登录 cookie，浏览器直敲会 401）。
 * 红线：这里没有任何能改她人格/数值的控件。
 */
window.__ModuleLoader__.load({
  id: 'dsh-herself',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = '/dsh-herself/api'
    const NS = 'herself'

    
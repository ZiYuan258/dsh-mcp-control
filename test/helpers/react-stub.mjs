// 一个会真的重渲染的 React 桩，给所有「视图渲染」类测试共用。
//
// 为什么不用 jsdom：本插件承诺零依赖，测试也不能引依赖。视图是纯函数返回纯树，
// 只要桩能跑 state/effect，就能断言「界面上到底写了什么」。
//
// 三个曾经踩过的桩 bug，别改回去：
//   1. 每次渲染清空 hook 槽 → setState 等于没生效，页面永远停在第一帧。
//   2. useCallback 返回新函数 → `useEffect(fn, [fn])` 立刻重跑，永远静默不下来。
//   3. createElement 不扁平化 children → `cond ? a : null` 与兄弟节点个数数错。

export function makeReact() {
  const records = new Map()
  const stack = []
  let queue = []
  let dirty = false

  const current = () => stack[stack.length - 1]

  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false),
  })

  const api = {
    createElement,
    useState(initial) {
      const rec = current()
      const at = rec.cursor++
      if (!(at in rec.slots)) rec.slots[at] = typeof initial === 'function' ? initial() : initial
      return [
        rec.slots[at],
        (next) => {
          const value = typeof next === 'function' ? next(rec.slots[at]) : next
          if (value !== rec.slots[at]) {
            rec.slots[at] = value
            dirty = true
          }
        },
      ]
    },
    useRef(initial) {
      const rec = current()
      const at = rec.cursor++
      if (!(at in rec.slots)) rec.slots[at] = { current: initial }
      return rec.slots[at]
    },
    // 按身份记忆：同一个函数身份重复使用，effect 的依赖数组才有意义。
    useCallback(fn, deps) {
      const rec = current()
      const at = rec.cursor++
      const prev = rec.slots[at]
      const same =
        prev &&
        prev.deps &&
        deps &&
        deps.length === prev.deps.length &&
        deps.every((value, index) => value === prev.deps[index])
      if (same) return prev.fn
      rec.slots[at] = { deps: deps ? [...deps] : null, fn }
      return fn
    },
    useEffect(fn, deps) {
      const rec = current()
      const at = rec.cursor++
      const prev = rec.slots[at]
      if (!prev) {
        rec.slots[at] = { deps: deps ? [...deps] : null, fn }
        queue.push({ rec, at })
        return
      }
      const same =
        !deps || !prev.deps
          ? false
          : deps.length === prev.deps.length && deps.every((value, index) => value === prev.deps[index])
      if (same) return
      prev.deps = deps ? [...deps] : null
      prev.fn = fn
      queue.push({ rec, at })
    },
  }

  function resolve(node) {
    if (node === null || node === undefined || node === false) return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(resolve).filter((child) => child !== null)
    if (typeof node !== 'object') return String(node)
    if (typeof node.type === 'function') {
      let rec = records.get(node.type)
      if (!rec) {
        rec = { slots: [] }
        records.set(node.type, rec)
      }
      rec.cursor = 0
      stack.push(rec)
      let out
      try {
        out = node.type(node.props)
      } finally {
        stack.pop()
      }
      return resolve(out)
    }
    return { tag: node.type, props: node.props, children: node.children.map(resolve).filter((c) => c !== null) }
  }

  function text(node) {
    if (node === null) return ''
    if (typeof node === 'string') return node
    if (Array.isArray(node)) return node.map(text).join(' ')
    return node.children.map(text).join(' ')
  }

  function findAll(node, hit, acc = []) {
    if (node === null || typeof node === 'string') return acc
    if (Array.isArray(node)) {
      for (const child of node) findAll(child, hit, acc)
      return acc
    }
    if (hit(node)) acc.push(node)
    for (const child of node.children) findAll(child, hit, acc)
    return acc
  }

  // 渲染 → 跑本次注册的 effect → 如果 state 变了再渲染，直到安静下来。
  async function settle(Component, props, rounds = 10) {
    let tree = resolve(createElement(Component, props))
    for (let round = 0; round < rounds; round += 1) {
      for (let i = 0; i < 40; i += 1) await new Promise((done) => setImmediate(done))
      const pending = queue
      queue = []
      for (const item of pending) {
        const slot = item.rec.slots[item.at]
        if (slot && typeof slot.cleanup === 'function') slot.cleanup()
        const cleanup = slot && slot.fn ? slot.fn() : undefined
        if (slot) slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
      if (!dirty && pending.length === 0) break
      dirty = false
      tree = resolve(createElement(Component, props))
    }
    return tree
  }

  return { api, settle, text, findAll, reset: () => records.clear() }
}

/** 取按钮上的纯文本。children 挂在这个桩的节点上，不在 props 里。 */
export function buttonText(node) {
  return node.children.map((child) => (typeof child === 'string' ? child : '')).join('')
}

/** 等若干轮微任务，用于「点了之后等异步回来」。 */
export async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await new Promise((done) => setImmediate(done))
}

export function waitForElement(
  selector: string,
  maxAttempts = 10,
  intervalMs = 500
): Promise<Element | null> {
  return new Promise(resolve => {
    let attempts = 0
    const check = () => {
      const el = document.querySelector(selector)
      if (el) return resolve(el)
      attempts++
      if (attempts >= maxAttempts) return resolve(null)
      setTimeout(check, intervalMs)
    }
    check()
  })
}

export function injectOnce(id: string, tag: string, setup: (el: HTMLElement) => void): HTMLElement {
  let el = document.getElementById(id)
  if (el) return el
  el = document.createElement(tag)
  el.id = id
  setup(el)
  return el
}

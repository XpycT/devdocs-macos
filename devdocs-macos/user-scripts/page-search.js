/* global $ */
(function () {
  const DATA_TEXTCONTENT = 'data-dd-original-textcontent'

  const flatten = function (xs) {
    return xs.reduce((acc, x) => {
      if (Array.isArray(x)) {
        return acc.concat(flatten(x))
      }
      return acc.concat([x])
    }, [])
  }

  const matchAll = function (regexp, str, fn) {
    let matches
    while ((matches = regexp.exec(str)) !== null) {
      fn(matches)
    }
  }

  const rootSearchNode = function () {
    return document.querySelector('main[role="main"]')
  }

  // From:
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
  const escapeRegExp = function (string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
  }

  const separate = function (string, substr) {
    const startIdx = string.indexOf(substr)
    const before = string.slice(0, startIdx)
    const after = string.slice(startIdx + substr.length, string.length)
    return [before, after]
  }

  const mutateDOM = function (mutations) {
    return new Promise(function (resolve, reject) {
      requestAnimationFrame(function () {
        resolve(mutations.map((mut) => mut()))
      })
    })
  }

  const hasSearchTerm = function (string, term) {
    return new RegExp(escapeRegExp(term), 'i').test(string)
  }

  const highlightTermInNode = function (node, term) {
    return function () {
      let content = node.textContent
      if (node.hasAttribute(DATA_TEXTCONTENT)) {
        content = node.getAttribute(DATA_TEXTCONTENT)
      } else {
        // Make backup of original textContent.
        node.setAttribute(DATA_TEXTCONTENT, content)
      }

      const fragment = document.createDocumentFragment()

      let text = content
      matchAll(new RegExp(escapeRegExp(term), 'gi'), text, (match) => {
        const [before, after] = separate(text, match[0])
        if (before.length > 0) {
          fragment.appendChild(document.createTextNode(before))
        }

        const mark = document.createElement('mark')
        mark.textContent = match[0]
        fragment.appendChild(mark)

        text = after
      })
      if (text.length > 0) {
        fragment.appendChild(document.createTextNode(text))
      }

      node.innerHTML = ''
      node.appendChild(fragment)
      // FIXME
      // Not sure sure why, but this is also returning nodes not
      // attached to the document tree.
      return Array.from(node.querySelectorAll('mark'))
    }
  }

  const restoreNodeTextContent = function (node) {
    return function () {
      if (node.hasAttribute(DATA_TEXTCONTENT)) {
        node.textContent = node.getAttribute(DATA_TEXTCONTENT)
        node.removeAttribute(DATA_TEXTCONTENT)
      }
    }
  }

  const reset = function () {
    const mainNode = rootSearchNode()
    const treeWalker = document.createTreeWalker(mainNode, NodeFilter.SHOW_ELEMENT, {
      acceptNode (node) {
        if (node.hasAttribute(DATA_TEXTCONTENT)) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_SKIP
      }
    })
    const domMutations = []
    while (treeWalker.nextNode()) {
      domMutations.push(restoreNodeTextContent(treeWalker.currentNode))
    }
    return mutateDOM(domMutations)
  }

  const search = function (term) {
    const mainNode = rootSearchNode()
    const treeWalker = document.createTreeWalker(mainNode, NodeFilter.SHOW_TEXT, {
      acceptNode (node) {
        var parent = node.parentNode
        if (parent.tagName === 'MARK') {
          return NodeFilter.FILTER_REJECT
        }
        // The node is not visible on the page.
        if (parent.offsetParent === null) {
          return NodeFilter.FILTER_REJECT
        }
        let content = node.textContent
        if (parent.hasAttribute(DATA_TEXTCONTENT)) {
          content = parent.getAttribute(DATA_TEXTCONTENT)
        }
        if (hasSearchTerm(content, term)) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_SKIP
      }
    })
    const domMutations = []
    while (treeWalker.nextNode()) {
      domMutations.push(highlightTermInNode(treeWalker.currentNode.parentNode, term))
    }
    return mutateDOM(domMutations)
  };

  // No reliable API to detect route transitions so that we can restore the
  // original page state.
  (function () {
    const observer = new MutationObserver(() => {
      window.resetSearch()
    })
    const titleEl = document.querySelector('title')
    observer.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true
    })
  })();

  // Install custom CSS
  (function () {
    const styleEl = document.createElement('style')
    styleEl.setAttribute('type', 'text/css')
    styleEl.textContent = `
          mark.dd-macos-current {
            border-width: 2px;
            border-style: solid;
            padding: 5px;
          }

          ._theme-default mark.dd-macos-current {
            border-color: #000;
          }

          ._theme-dark mark {
            background-color: #fff;
            color: #000;
          }

          ._theme-dark mark.dd-macos-current {
            background-color: #000;
            border-color: #fff;
            color: #fff;
          }
        `
    document.querySelector('head').appendChild(styleEl)
  })()

  class SearchState {
    constructor ({ term, marks }) {
      this.term = term
      // FIXME
      // For some reason, we are getting nodes that are not attached
      // to the document tree. Work around this issue by filtering out
      // nodes not attached to the tree.
      this.marks = marks.filter(mark => document.body.contains(mark))
    }

    isCurrentTerm (term) {
      return this.term === term
    }

    async spotlightMark () {
      if (this.marks.length === 0) {
        return this
      }
      const [next, ...rest] = this.marks
      const prev = this.marks[this.marks.length - 1]

      await mutateDOM([() => {
        prev.removeAttribute('class')
        next.setAttribute('class', 'dd-macos-current')
        // Use DevDocs own utilities.
        $.scrollTo(next)
      }])

      this.marks = rest.concat([next])
      return this
    }
  }

  let searchState

  // Public API

  window.search = async function (term) {
    if (typeof term !== 'string') {
      return false
    }

    const searchTerm = term.trim()
    if (searchTerm === '') {
      return false
    }

    if (searchState && searchState.isCurrentTerm(searchTerm)) {
      await searchState.spotlightMark()
      return true
    }

    await reset()
    const insertedMarks = await search(searchTerm)
    const ss = new SearchState({
      term,
      marks: flatten(insertedMarks)
    })
    await ss.spotlightMark()
    searchState = ss
    return true
  }

  window.resetSearch = async function () {
    await reset()
    searchState = null
    return true
  }
})()

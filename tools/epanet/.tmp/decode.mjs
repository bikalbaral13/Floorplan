var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../engine/node_modules/splaytree/dist/splaytree.umd.cjs
var require_splaytree_umd = __commonJS({
  "../engine/node_modules/splaytree/dist/splaytree.umd.cjs"(exports, module) {
    (function(h, c) {
      typeof exports == "object" && typeof module < "u" ? module.exports = c() : typeof define == "function" && define.amd ? define(c) : (h = typeof globalThis < "u" ? globalThis : h || self, h.SplayTree = c());
    })(exports, (function() {
      "use strict";
      class h {
        constructor(t, e) {
          this.next = null, this.key = t, this.data = e, this.left = null, this.right = null;
        }
      }
      function c(n, t) {
        return n > t ? 1 : n < t ? -1 : 0;
      }
      function u(n, t, e) {
        const r = new h(null, null);
        let i = r, l = r;
        for (; ; ) {
          const o = e(n, t.key);
          if (o < 0) {
            if (t.left === null) break;
            if (e(n, t.left.key) < 0) {
              const s = t.left;
              if (t.left = s.right, s.right = t, t = s, t.left === null) break;
            }
            l.left = t, l = t, t = t.left;
          } else if (o > 0) {
            if (t.right === null) break;
            if (e(n, t.right.key) > 0) {
              const s = t.right;
              if (t.right = s.left, s.left = t, t = s, t.right === null) break;
            }
            i.right = t, i = t, t = t.right;
          } else break;
        }
        return i.right = t.left, l.left = t.right, t.left = r.right, t.right = r.left, t;
      }
      function _(n, t, e, r) {
        const i = new h(n, t);
        if (e === null) return i.left = i.right = null, i;
        e = u(n, e, r);
        const l = r(n, e.key);
        return l < 0 ? (i.left = e.left, i.right = e, e.left = null) : l >= 0 && (i.right = e.right, i.left = e, e.right = null), i;
      }
      function d(n, t, e) {
        let r = null, i = null;
        if (t) {
          t = u(n, t, e);
          const l = e(t.key, n);
          l === 0 ? (r = t.left, i = t.right) : l < 0 ? (i = t.right, t.right = null, r = t) : (r = t.left, t.left = null, i = t);
        }
        return { left: r, right: i };
      }
      function w(n, t, e) {
        return t === null ? n : (n === null || (t = u(n.key, t, e), t.left = n), t);
      }
      function a(n, t, e, r, i) {
        if (n) {
          r(`${t}${e ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 "}${i(n)}
`);
          const l = t + (e ? "    " : "\u2502   ");
          n.left && a(n.left, l, false, r, i), n.right && a(n.right, l, true, r, i);
        }
      }
      class x {
        constructor(t = c) {
          this._root = null, this._size = 0, this._comparator = t;
        }
        insert(t, e) {
          return this._size++, this._root = _(t, e, this._root, this._comparator);
        }
        add(t, e) {
          const r = new h(t, e);
          this._root === null && (r.left = r.right = null, this._size++, this._root = r);
          const i = this._comparator, l = u(t, this._root, i), o = i(t, l.key);
          return o === 0 ? this._root = l : (o < 0 ? (r.left = l.left, r.right = l, l.left = null) : o > 0 && (r.right = l.right, r.left = l, l.right = null), this._size++, this._root = r), this._root;
        }
        remove(t) {
          this._root = this._remove(t, this._root, this._comparator);
        }
        _remove(t, e, r) {
          let i;
          return e === null ? null : (e = u(t, e, r), r(t, e.key) === 0 ? (e.left === null ? i = e.right : (i = u(t, e.left, r), i.right = e.right), this._size--, i) : e);
        }
        pop() {
          let t = this._root;
          if (t) {
            for (; t.left; ) t = t.left;
            return this._root = u(t.key, this._root, this._comparator), this._root = this._remove(t.key, this._root, this._comparator), { key: t.key, data: t.data };
          }
          return null;
        }
        findStatic(t) {
          let e = this._root;
          const r = this._comparator;
          for (; e; ) {
            const i = r(t, e.key);
            if (i === 0) return e;
            i < 0 ? e = e.left : e = e.right;
          }
          return null;
        }
        find(t) {
          return this._root && (this._root = u(t, this._root, this._comparator), this._comparator(t, this._root.key) !== 0) ? null : this._root;
        }
        contains(t) {
          let e = this._root;
          const r = this._comparator;
          for (; e; ) {
            const i = r(t, e.key);
            if (i === 0) return true;
            i < 0 ? e = e.left : e = e.right;
          }
          return false;
        }
        forEach(t, e) {
          let r = this._root;
          const i = [];
          let l = false;
          for (; !l; ) r !== null ? (i.push(r), r = r.left) : i.length !== 0 ? (r = i.pop(), t.call(e, r), r = r.right) : l = true;
          return this;
        }
        range(t, e, r, i) {
          const l = [], o = this._comparator;
          let s = this._root, f;
          for (; l.length !== 0 || s; ) if (s) l.push(s), s = s.left;
          else {
            if (s = l.pop(), f = o(s.key, e), f > 0) break;
            if (o(s.key, t) >= 0 && r.call(i, s)) return this;
            s = s.right;
          }
          return this;
        }
        keys() {
          const t = [];
          return this.forEach(({ key: e }) => {
            t.push(e);
          }), t;
        }
        values() {
          const t = [];
          return this.forEach(({ data: e }) => {
            t.push(e);
          }), t;
        }
        min() {
          return this._root ? this.minNode(this._root).key : null;
        }
        max() {
          return this._root ? this.maxNode(this._root).key : null;
        }
        minNode(t = this._root) {
          if (t) for (; t.left; ) t = t.left;
          return t;
        }
        maxNode(t = this._root) {
          if (t) for (; t.right; ) t = t.right;
          return t;
        }
        at(t) {
          let e = this._root, r = false, i = 0;
          const l = [];
          for (; !r; ) if (e) l.push(e), e = e.left;
          else if (l.length > 0) {
            if (e = l.pop(), i === t) return e;
            i++, e = e.right;
          } else r = true;
          return null;
        }
        next(t) {
          let e = this._root, r = null;
          if (t.right) {
            for (r = t.right; r.left; ) r = r.left;
            return r;
          }
          const i = this._comparator;
          for (; e; ) {
            const l = i(t.key, e.key);
            if (l === 0) break;
            l < 0 ? (r = e, e = e.left) : e = e.right;
          }
          return r;
        }
        prev(t) {
          let e = this._root, r = null;
          if (t.left !== null) {
            for (r = t.left; r.right; ) r = r.right;
            return r;
          }
          const i = this._comparator;
          for (; e; ) {
            const l = i(t.key, e.key);
            if (l === 0) break;
            l < 0 ? e = e.left : (r = e, e = e.right);
          }
          return r;
        }
        clear() {
          return this._root = null, this._size = 0, this;
        }
        toList() {
          return y(this._root);
        }
        load(t, e = [], r = false) {
          let i = t.length;
          const l = this._comparator;
          if (r && m(t, e, 0, i - 1, l), this._root === null) this._root = p(t, e, 0, i), this._size = i;
          else {
            const o = z(this.toList(), k(t, e), l);
            i = this._size + i, this._root = g({ head: o }, 0, i);
          }
          return this;
        }
        isEmpty() {
          return this._root === null;
        }
        get size() {
          return this._size;
        }
        get root() {
          return this._root;
        }
        toString(t = (e) => String(e.key)) {
          const e = [];
          return a(this._root, "", true, (r) => e.push(r), t), e.join("");
        }
        update(t, e, r) {
          const i = this._comparator;
          let { left: l, right: o } = d(t, this._root, i);
          i(t, e) < 0 ? o = _(e, r, o, i) : l = _(e, r, l, i), this._root = w(l, o, i);
        }
        split(t) {
          return d(t, this._root, this._comparator);
        }
        *[Symbol.iterator]() {
          let t = this._root;
          const e = [];
          let r = false;
          for (; !r; ) t !== null ? (e.push(t), t = t.left) : e.length !== 0 ? (t = e.pop(), yield t, t = t.right) : r = true;
        }
      }
      function p(n, t, e, r) {
        const i = r - e;
        if (i > 0) {
          const l = e + Math.floor(i / 2), o = n[l], s = t[l], f = new h(o, s);
          return f.left = p(n, t, e, l), f.right = p(n, t, l + 1, r), f;
        }
        return null;
      }
      function k(n, t) {
        const e = new h(null, null);
        let r = e;
        for (let i = 0; i < n.length; i++) r = r.next = new h(n[i], t[i]);
        return r.next = null, e.next;
      }
      function y(n) {
        let t = n;
        const e = [];
        let r = false;
        const i = new h(null, null);
        let l = i;
        for (; !r; ) t ? (e.push(t), t = t.left) : e.length > 0 ? (t = l = l.next = e.pop(), t = t.right) : r = true;
        return l.next = null, i.next;
      }
      function g(n, t, e) {
        const r = e - t;
        if (r > 0) {
          const i = t + Math.floor(r / 2), l = g(n, t, i), o = n.head;
          return o.left = l, n.head = n.head.next, o.right = g(n, i + 1, e), o;
        }
        return null;
      }
      function z(n, t, e) {
        const r = new h(null, null);
        let i = r, l = n, o = t;
        for (; l !== null && o !== null; ) e(l.key, o.key) < 0 ? (i.next = l, l = l.next) : (i.next = o, o = o.next), i = i.next;
        return l !== null ? i.next = l : o !== null && (i.next = o), r.next;
      }
      function m(n, t, e, r, i) {
        if (e >= r) return;
        const l = n[e + r >> 1];
        let o = e - 1, s = r + 1;
        for (; ; ) {
          do
            o++;
          while (i(n[o], l) < 0);
          do
            s--;
          while (i(n[s], l) > 0);
          if (o >= s) break;
          let f = n[o];
          n[o] = n[s], n[s] = f, f = t[o], t[o] = t[s], t[s] = f;
        }
        m(n, t, e, s, i), m(n, t, s + 1, r, i);
      }
      return x;
    }));
  }
});

// ../engine/node_modules/polygon-clipping/dist/polygon-clipping.cjs.js
var require_polygon_clipping_cjs = __commonJS({
  "../engine/node_modules/polygon-clipping/dist/polygon-clipping.cjs.js"(exports, module) {
    "use strict";
    var SplayTree = require_splaytree_umd();
    function _interopDefaultLegacy(e) {
      return e && typeof e === "object" && "default" in e ? e : { "default": e };
    }
    var SplayTree__default = /* @__PURE__ */ _interopDefaultLegacy(SplayTree);
    var isInBbox = (bbox, point) => {
      return bbox.ll.x <= point.x && point.x <= bbox.ur.x && bbox.ll.y <= point.y && point.y <= bbox.ur.y;
    };
    var getBboxOverlap = (b1, b2) => {
      if (b2.ur.x < b1.ll.x || b1.ur.x < b2.ll.x || b2.ur.y < b1.ll.y || b1.ur.y < b2.ll.y) return null;
      const lowerX = b1.ll.x < b2.ll.x ? b2.ll.x : b1.ll.x;
      const upperX = b1.ur.x < b2.ur.x ? b1.ur.x : b2.ur.x;
      const lowerY = b1.ll.y < b2.ll.y ? b2.ll.y : b1.ll.y;
      const upperY = b1.ur.y < b2.ur.y ? b1.ur.y : b2.ur.y;
      return {
        ll: {
          x: lowerX,
          y: lowerY
        },
        ur: {
          x: upperX,
          y: upperY
        }
      };
    };
    var epsilon$1 = Number.EPSILON;
    if (epsilon$1 === void 0) epsilon$1 = Math.pow(2, -52);
    var EPSILON_SQ = epsilon$1 * epsilon$1;
    var cmp = (a, b) => {
      if (-epsilon$1 < a && a < epsilon$1) {
        if (-epsilon$1 < b && b < epsilon$1) {
          return 0;
        }
      }
      const ab = a - b;
      if (ab * ab < EPSILON_SQ * a * b) {
        return 0;
      }
      return a < b ? -1 : 1;
    };
    var PtRounder = class {
      constructor() {
        this.reset();
      }
      reset() {
        this.xRounder = new CoordRounder();
        this.yRounder = new CoordRounder();
      }
      round(x, y) {
        return {
          x: this.xRounder.round(x),
          y: this.yRounder.round(y)
        };
      }
    };
    var CoordRounder = class {
      constructor() {
        this.tree = new SplayTree__default["default"]();
        this.round(0);
      }
      // Note: this can rounds input values backwards or forwards.
      //       You might ask, why not restrict this to just rounding
      //       forwards? Wouldn't that allow left endpoints to always
      //       remain left endpoints during splitting (never change to
      //       right). No - it wouldn't, because we snap intersections
      //       to endpoints (to establish independence from the segment
      //       angle for t-intersections).
      round(coord) {
        const node = this.tree.add(coord);
        const prevNode = this.tree.prev(node);
        if (prevNode !== null && cmp(node.key, prevNode.key) === 0) {
          this.tree.remove(coord);
          return prevNode.key;
        }
        const nextNode = this.tree.next(node);
        if (nextNode !== null && cmp(node.key, nextNode.key) === 0) {
          this.tree.remove(coord);
          return nextNode.key;
        }
        return coord;
      }
    };
    var rounder = new PtRounder();
    var epsilon = 11102230246251565e-32;
    var splitter = 134217729;
    var resulterrbound = (3 + 8 * epsilon) * epsilon;
    function sum(elen, e, flen, f, h) {
      let Q, Qnew, hh, bvirt;
      let enow = e[0];
      let fnow = f[0];
      let eindex = 0;
      let findex = 0;
      if (fnow > enow === fnow > -enow) {
        Q = enow;
        enow = e[++eindex];
      } else {
        Q = fnow;
        fnow = f[++findex];
      }
      let hindex = 0;
      if (eindex < elen && findex < flen) {
        if (fnow > enow === fnow > -enow) {
          Qnew = enow + Q;
          hh = Q - (Qnew - enow);
          enow = e[++eindex];
        } else {
          Qnew = fnow + Q;
          hh = Q - (Qnew - fnow);
          fnow = f[++findex];
        }
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
        while (eindex < elen && findex < flen) {
          if (fnow > enow === fnow > -enow) {
            Qnew = Q + enow;
            bvirt = Qnew - Q;
            hh = Q - (Qnew - bvirt) + (enow - bvirt);
            enow = e[++eindex];
          } else {
            Qnew = Q + fnow;
            bvirt = Qnew - Q;
            hh = Q - (Qnew - bvirt) + (fnow - bvirt);
            fnow = f[++findex];
          }
          Q = Qnew;
          if (hh !== 0) {
            h[hindex++] = hh;
          }
        }
      }
      while (eindex < elen) {
        Qnew = Q + enow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (enow - bvirt);
        enow = e[++eindex];
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
      }
      while (findex < flen) {
        Qnew = Q + fnow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (fnow - bvirt);
        fnow = f[++findex];
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
      }
      if (Q !== 0 || hindex === 0) {
        h[hindex++] = Q;
      }
      return hindex;
    }
    function estimate(elen, e) {
      let Q = e[0];
      for (let i = 1; i < elen; i++) Q += e[i];
      return Q;
    }
    function vec(n) {
      return new Float64Array(n);
    }
    var ccwerrboundA = (3 + 16 * epsilon) * epsilon;
    var ccwerrboundB = (2 + 12 * epsilon) * epsilon;
    var ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;
    var B = vec(4);
    var C1 = vec(8);
    var C2 = vec(12);
    var D = vec(16);
    var u = vec(4);
    function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
      let acxtail, acytail, bcxtail, bcytail;
      let bvirt, c, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u3;
      const acx = ax - cx;
      const bcx = bx - cx;
      const acy = ay - cy;
      const bcy = by - cy;
      s1 = acx * bcy;
      c = splitter * acx;
      ahi = c - (c - acx);
      alo = acx - ahi;
      c = splitter * bcy;
      bhi = c - (c - bcy);
      blo = bcy - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acy * bcx;
      c = splitter * acy;
      ahi = c - (c - acy);
      alo = acy - ahi;
      c = splitter * bcx;
      bhi = c - (c - bcx);
      blo = bcx - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      B[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      B[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      B[2] = _j - (u3 - bvirt) + (_i - bvirt);
      B[3] = u3;
      let det = estimate(4, B);
      let errbound = ccwerrboundB * detsum;
      if (det >= errbound || -det >= errbound) {
        return det;
      }
      bvirt = ax - acx;
      acxtail = ax - (acx + bvirt) + (bvirt - cx);
      bvirt = bx - bcx;
      bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
      bvirt = ay - acy;
      acytail = ay - (acy + bvirt) + (bvirt - cy);
      bvirt = by - bcy;
      bcytail = by - (bcy + bvirt) + (bvirt - cy);
      if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
        return det;
      }
      errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
      det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
      if (det >= errbound || -det >= errbound) return det;
      s1 = acxtail * bcy;
      c = splitter * acxtail;
      ahi = c - (c - acxtail);
      alo = acxtail - ahi;
      c = splitter * bcy;
      bhi = c - (c - bcy);
      blo = bcy - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acytail * bcx;
      c = splitter * acytail;
      ahi = c - (c - acytail);
      alo = acytail - ahi;
      c = splitter * bcx;
      bhi = c - (c - bcx);
      blo = bcx - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      u[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      u[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      u[2] = _j - (u3 - bvirt) + (_i - bvirt);
      u[3] = u3;
      const C1len = sum(4, B, 4, u, C1);
      s1 = acx * bcytail;
      c = splitter * acx;
      ahi = c - (c - acx);
      alo = acx - ahi;
      c = splitter * bcytail;
      bhi = c - (c - bcytail);
      blo = bcytail - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acy * bcxtail;
      c = splitter * acy;
      ahi = c - (c - acy);
      alo = acy - ahi;
      c = splitter * bcxtail;
      bhi = c - (c - bcxtail);
      blo = bcxtail - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      u[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      u[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      u[2] = _j - (u3 - bvirt) + (_i - bvirt);
      u[3] = u3;
      const C2len = sum(C1len, C1, 4, u, C2);
      s1 = acxtail * bcytail;
      c = splitter * acxtail;
      ahi = c - (c - acxtail);
      alo = acxtail - ahi;
      c = splitter * bcytail;
      bhi = c - (c - bcytail);
      blo = bcytail - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acytail * bcxtail;
      c = splitter * acytail;
      ahi = c - (c - acytail);
      alo = acytail - ahi;
      c = splitter * bcxtail;
      bhi = c - (c - bcxtail);
      blo = bcxtail - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      u[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      u[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      u[2] = _j - (u3 - bvirt) + (_i - bvirt);
      u[3] = u3;
      const Dlen = sum(C2len, C2, 4, u, D);
      return D[Dlen - 1];
    }
    function orient2d(ax, ay, bx, by, cx, cy) {
      const detleft = (ay - cy) * (bx - cx);
      const detright = (ax - cx) * (by - cy);
      const det = detleft - detright;
      const detsum = Math.abs(detleft + detright);
      if (Math.abs(det) >= ccwerrboundA * detsum) return det;
      return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
    }
    var crossProduct = (a, b) => a.x * b.y - a.y * b.x;
    var dotProduct = (a, b) => a.x * b.x + a.y * b.y;
    var compareVectorAngles = (basePt, endPt1, endPt2) => {
      const res = orient2d(basePt.x, basePt.y, endPt1.x, endPt1.y, endPt2.x, endPt2.y);
      if (res > 0) return -1;
      if (res < 0) return 1;
      return 0;
    };
    var length = (v) => Math.sqrt(dotProduct(v, v));
    var sineOfAngle = (pShared, pBase, pAngle) => {
      const vBase = {
        x: pBase.x - pShared.x,
        y: pBase.y - pShared.y
      };
      const vAngle = {
        x: pAngle.x - pShared.x,
        y: pAngle.y - pShared.y
      };
      return crossProduct(vAngle, vBase) / length(vAngle) / length(vBase);
    };
    var cosineOfAngle = (pShared, pBase, pAngle) => {
      const vBase = {
        x: pBase.x - pShared.x,
        y: pBase.y - pShared.y
      };
      const vAngle = {
        x: pAngle.x - pShared.x,
        y: pAngle.y - pShared.y
      };
      return dotProduct(vAngle, vBase) / length(vAngle) / length(vBase);
    };
    var horizontalIntersection = (pt, v, y) => {
      if (v.y === 0) return null;
      return {
        x: pt.x + v.x / v.y * (y - pt.y),
        y
      };
    };
    var verticalIntersection = (pt, v, x) => {
      if (v.x === 0) return null;
      return {
        x,
        y: pt.y + v.y / v.x * (x - pt.x)
      };
    };
    var intersection$1 = (pt1, v1, pt2, v2) => {
      if (v1.x === 0) return verticalIntersection(pt2, v2, pt1.x);
      if (v2.x === 0) return verticalIntersection(pt1, v1, pt2.x);
      if (v1.y === 0) return horizontalIntersection(pt2, v2, pt1.y);
      if (v2.y === 0) return horizontalIntersection(pt1, v1, pt2.y);
      const kross = crossProduct(v1, v2);
      if (kross == 0) return null;
      const ve = {
        x: pt2.x - pt1.x,
        y: pt2.y - pt1.y
      };
      const d1 = crossProduct(ve, v1) / kross;
      const d2 = crossProduct(ve, v2) / kross;
      const x1 = pt1.x + d2 * v1.x, x2 = pt2.x + d1 * v2.x;
      const y1 = pt1.y + d2 * v1.y, y2 = pt2.y + d1 * v2.y;
      const x = (x1 + x2) / 2;
      const y = (y1 + y2) / 2;
      return {
        x,
        y
      };
    };
    var SweepEvent = class _SweepEvent {
      // for ordering sweep events in the sweep event queue
      static compare(a, b) {
        const ptCmp = _SweepEvent.comparePoints(a.point, b.point);
        if (ptCmp !== 0) return ptCmp;
        if (a.point !== b.point) a.link(b);
        if (a.isLeft !== b.isLeft) return a.isLeft ? 1 : -1;
        return Segment.compare(a.segment, b.segment);
      }
      // for ordering points in sweep line order
      static comparePoints(aPt, bPt) {
        if (aPt.x < bPt.x) return -1;
        if (aPt.x > bPt.x) return 1;
        if (aPt.y < bPt.y) return -1;
        if (aPt.y > bPt.y) return 1;
        return 0;
      }
      // Warning: 'point' input will be modified and re-used (for performance)
      constructor(point, isLeft) {
        if (point.events === void 0) point.events = [this];
        else point.events.push(this);
        this.point = point;
        this.isLeft = isLeft;
      }
      link(other) {
        if (other.point === this.point) {
          throw new Error("Tried to link already linked events");
        }
        const otherEvents = other.point.events;
        for (let i = 0, iMax = otherEvents.length; i < iMax; i++) {
          const evt = otherEvents[i];
          this.point.events.push(evt);
          evt.point = this.point;
        }
        this.checkForConsuming();
      }
      /* Do a pass over our linked events and check to see if any pair
       * of segments match, and should be consumed. */
      checkForConsuming() {
        const numEvents = this.point.events.length;
        for (let i = 0; i < numEvents; i++) {
          const evt1 = this.point.events[i];
          if (evt1.segment.consumedBy !== void 0) continue;
          for (let j = i + 1; j < numEvents; j++) {
            const evt2 = this.point.events[j];
            if (evt2.consumedBy !== void 0) continue;
            if (evt1.otherSE.point.events !== evt2.otherSE.point.events) continue;
            evt1.segment.consume(evt2.segment);
          }
        }
      }
      getAvailableLinkedEvents() {
        const events = [];
        for (let i = 0, iMax = this.point.events.length; i < iMax; i++) {
          const evt = this.point.events[i];
          if (evt !== this && !evt.segment.ringOut && evt.segment.isInResult()) {
            events.push(evt);
          }
        }
        return events;
      }
      /**
       * Returns a comparator function for sorting linked events that will
       * favor the event that will give us the smallest left-side angle.
       * All ring construction starts as low as possible heading to the right,
       * so by always turning left as sharp as possible we'll get polygons
       * without uncessary loops & holes.
       *
       * The comparator function has a compute cache such that it avoids
       * re-computing already-computed values.
       */
      getLeftmostComparator(baseEvent) {
        const cache = /* @__PURE__ */ new Map();
        const fillCache = (linkedEvent) => {
          const nextEvent = linkedEvent.otherSE;
          cache.set(linkedEvent, {
            sine: sineOfAngle(this.point, baseEvent.point, nextEvent.point),
            cosine: cosineOfAngle(this.point, baseEvent.point, nextEvent.point)
          });
        };
        return (a, b) => {
          if (!cache.has(a)) fillCache(a);
          if (!cache.has(b)) fillCache(b);
          const {
            sine: asine,
            cosine: acosine
          } = cache.get(a);
          const {
            sine: bsine,
            cosine: bcosine
          } = cache.get(b);
          if (asine >= 0 && bsine >= 0) {
            if (acosine < bcosine) return 1;
            if (acosine > bcosine) return -1;
            return 0;
          }
          if (asine < 0 && bsine < 0) {
            if (acosine < bcosine) return -1;
            if (acosine > bcosine) return 1;
            return 0;
          }
          if (bsine < asine) return -1;
          if (bsine > asine) return 1;
          return 0;
        };
      }
    };
    var segmentId = 0;
    var Segment = class _Segment {
      /* This compare() function is for ordering segments in the sweep
       * line tree, and does so according to the following criteria:
       *
       * Consider the vertical line that lies an infinestimal step to the
       * right of the right-more of the two left endpoints of the input
       * segments. Imagine slowly moving a point up from negative infinity
       * in the increasing y direction. Which of the two segments will that
       * point intersect first? That segment comes 'before' the other one.
       *
       * If neither segment would be intersected by such a line, (if one
       * or more of the segments are vertical) then the line to be considered
       * is directly on the right-more of the two left inputs.
       */
      static compare(a, b) {
        const alx = a.leftSE.point.x;
        const blx = b.leftSE.point.x;
        const arx = a.rightSE.point.x;
        const brx = b.rightSE.point.x;
        if (brx < alx) return 1;
        if (arx < blx) return -1;
        const aly = a.leftSE.point.y;
        const bly = b.leftSE.point.y;
        const ary = a.rightSE.point.y;
        const bry = b.rightSE.point.y;
        if (alx < blx) {
          if (bly < aly && bly < ary) return 1;
          if (bly > aly && bly > ary) return -1;
          const aCmpBLeft = a.comparePoint(b.leftSE.point);
          if (aCmpBLeft < 0) return 1;
          if (aCmpBLeft > 0) return -1;
          const bCmpARight = b.comparePoint(a.rightSE.point);
          if (bCmpARight !== 0) return bCmpARight;
          return -1;
        }
        if (alx > blx) {
          if (aly < bly && aly < bry) return -1;
          if (aly > bly && aly > bry) return 1;
          const bCmpALeft = b.comparePoint(a.leftSE.point);
          if (bCmpALeft !== 0) return bCmpALeft;
          const aCmpBRight = a.comparePoint(b.rightSE.point);
          if (aCmpBRight < 0) return 1;
          if (aCmpBRight > 0) return -1;
          return 1;
        }
        if (aly < bly) return -1;
        if (aly > bly) return 1;
        if (arx < brx) {
          const bCmpARight = b.comparePoint(a.rightSE.point);
          if (bCmpARight !== 0) return bCmpARight;
        }
        if (arx > brx) {
          const aCmpBRight = a.comparePoint(b.rightSE.point);
          if (aCmpBRight < 0) return 1;
          if (aCmpBRight > 0) return -1;
        }
        if (arx !== brx) {
          const ay = ary - aly;
          const ax = arx - alx;
          const by = bry - bly;
          const bx = brx - blx;
          if (ay > ax && by < bx) return 1;
          if (ay < ax && by > bx) return -1;
        }
        if (arx > brx) return 1;
        if (arx < brx) return -1;
        if (ary < bry) return -1;
        if (ary > bry) return 1;
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      }
      /* Warning: a reference to ringWindings input will be stored,
       *  and possibly will be later modified */
      constructor(leftSE, rightSE, rings, windings) {
        this.id = ++segmentId;
        this.leftSE = leftSE;
        leftSE.segment = this;
        leftSE.otherSE = rightSE;
        this.rightSE = rightSE;
        rightSE.segment = this;
        rightSE.otherSE = leftSE;
        this.rings = rings;
        this.windings = windings;
      }
      static fromRing(pt1, pt2, ring) {
        let leftPt, rightPt, winding;
        const cmpPts = SweepEvent.comparePoints(pt1, pt2);
        if (cmpPts < 0) {
          leftPt = pt1;
          rightPt = pt2;
          winding = 1;
        } else if (cmpPts > 0) {
          leftPt = pt2;
          rightPt = pt1;
          winding = -1;
        } else throw new Error(`Tried to create degenerate segment at [${pt1.x}, ${pt1.y}]`);
        const leftSE = new SweepEvent(leftPt, true);
        const rightSE = new SweepEvent(rightPt, false);
        return new _Segment(leftSE, rightSE, [ring], [winding]);
      }
      /* When a segment is split, the rightSE is replaced with a new sweep event */
      replaceRightSE(newRightSE) {
        this.rightSE = newRightSE;
        this.rightSE.segment = this;
        this.rightSE.otherSE = this.leftSE;
        this.leftSE.otherSE = this.rightSE;
      }
      bbox() {
        const y1 = this.leftSE.point.y;
        const y2 = this.rightSE.point.y;
        return {
          ll: {
            x: this.leftSE.point.x,
            y: y1 < y2 ? y1 : y2
          },
          ur: {
            x: this.rightSE.point.x,
            y: y1 > y2 ? y1 : y2
          }
        };
      }
      /* A vector from the left point to the right */
      vector() {
        return {
          x: this.rightSE.point.x - this.leftSE.point.x,
          y: this.rightSE.point.y - this.leftSE.point.y
        };
      }
      isAnEndpoint(pt) {
        return pt.x === this.leftSE.point.x && pt.y === this.leftSE.point.y || pt.x === this.rightSE.point.x && pt.y === this.rightSE.point.y;
      }
      /* Compare this segment with a point.
       *
       * A point P is considered to be colinear to a segment if there
       * exists a distance D such that if we travel along the segment
       * from one * endpoint towards the other a distance D, we find
       * ourselves at point P.
       *
       * Return value indicates:
       *
       *   1: point lies above the segment (to the left of vertical)
       *   0: point is colinear to segment
       *  -1: point lies below the segment (to the right of vertical)
       */
      comparePoint(point) {
        if (this.isAnEndpoint(point)) return 0;
        const lPt = this.leftSE.point;
        const rPt = this.rightSE.point;
        const v = this.vector();
        if (lPt.x === rPt.x) {
          if (point.x === lPt.x) return 0;
          return point.x < lPt.x ? 1 : -1;
        }
        const yDist = (point.y - lPt.y) / v.y;
        const xFromYDist = lPt.x + yDist * v.x;
        if (point.x === xFromYDist) return 0;
        const xDist = (point.x - lPt.x) / v.x;
        const yFromXDist = lPt.y + xDist * v.y;
        if (point.y === yFromXDist) return 0;
        return point.y < yFromXDist ? -1 : 1;
      }
      /**
       * Given another segment, returns the first non-trivial intersection
       * between the two segments (in terms of sweep line ordering), if it exists.
       *
       * A 'non-trivial' intersection is one that will cause one or both of the
       * segments to be split(). As such, 'trivial' vs. 'non-trivial' intersection:
       *
       *   * endpoint of segA with endpoint of segB --> trivial
       *   * endpoint of segA with point along segB --> non-trivial
       *   * endpoint of segB with point along segA --> non-trivial
       *   * point along segA with point along segB --> non-trivial
       *
       * If no non-trivial intersection exists, return null
       * Else, return null.
       */
      getIntersection(other) {
        const tBbox = this.bbox();
        const oBbox = other.bbox();
        const bboxOverlap = getBboxOverlap(tBbox, oBbox);
        if (bboxOverlap === null) return null;
        const tlp = this.leftSE.point;
        const trp = this.rightSE.point;
        const olp = other.leftSE.point;
        const orp = other.rightSE.point;
        const touchesOtherLSE = isInBbox(tBbox, olp) && this.comparePoint(olp) === 0;
        const touchesThisLSE = isInBbox(oBbox, tlp) && other.comparePoint(tlp) === 0;
        const touchesOtherRSE = isInBbox(tBbox, orp) && this.comparePoint(orp) === 0;
        const touchesThisRSE = isInBbox(oBbox, trp) && other.comparePoint(trp) === 0;
        if (touchesThisLSE && touchesOtherLSE) {
          if (touchesThisRSE && !touchesOtherRSE) return trp;
          if (!touchesThisRSE && touchesOtherRSE) return orp;
          return null;
        }
        if (touchesThisLSE) {
          if (touchesOtherRSE) {
            if (tlp.x === orp.x && tlp.y === orp.y) return null;
          }
          return tlp;
        }
        if (touchesOtherLSE) {
          if (touchesThisRSE) {
            if (trp.x === olp.x && trp.y === olp.y) return null;
          }
          return olp;
        }
        if (touchesThisRSE && touchesOtherRSE) return null;
        if (touchesThisRSE) return trp;
        if (touchesOtherRSE) return orp;
        const pt = intersection$1(tlp, this.vector(), olp, other.vector());
        if (pt === null) return null;
        if (!isInBbox(bboxOverlap, pt)) return null;
        return rounder.round(pt.x, pt.y);
      }
      /**
       * Split the given segment into multiple segments on the given points.
       *  * Each existing segment will retain its leftSE and a new rightSE will be
       *    generated for it.
       *  * A new segment will be generated which will adopt the original segment's
       *    rightSE, and a new leftSE will be generated for it.
       *  * If there are more than two points given to split on, new segments
       *    in the middle will be generated with new leftSE and rightSE's.
       *  * An array of the newly generated SweepEvents will be returned.
       *
       * Warning: input array of points is modified
       */
      split(point) {
        const newEvents = [];
        const alreadyLinked = point.events !== void 0;
        const newLeftSE = new SweepEvent(point, true);
        const newRightSE = new SweepEvent(point, false);
        const oldRightSE = this.rightSE;
        this.replaceRightSE(newRightSE);
        newEvents.push(newRightSE);
        newEvents.push(newLeftSE);
        const newSeg = new _Segment(newLeftSE, oldRightSE, this.rings.slice(), this.windings.slice());
        if (SweepEvent.comparePoints(newSeg.leftSE.point, newSeg.rightSE.point) > 0) {
          newSeg.swapEvents();
        }
        if (SweepEvent.comparePoints(this.leftSE.point, this.rightSE.point) > 0) {
          this.swapEvents();
        }
        if (alreadyLinked) {
          newLeftSE.checkForConsuming();
          newRightSE.checkForConsuming();
        }
        return newEvents;
      }
      /* Swap which event is left and right */
      swapEvents() {
        const tmpEvt = this.rightSE;
        this.rightSE = this.leftSE;
        this.leftSE = tmpEvt;
        this.leftSE.isLeft = true;
        this.rightSE.isLeft = false;
        for (let i = 0, iMax = this.windings.length; i < iMax; i++) {
          this.windings[i] *= -1;
        }
      }
      /* Consume another segment. We take their rings under our wing
       * and mark them as consumed. Use for perfectly overlapping segments */
      consume(other) {
        let consumer = this;
        let consumee = other;
        while (consumer.consumedBy) consumer = consumer.consumedBy;
        while (consumee.consumedBy) consumee = consumee.consumedBy;
        const cmp2 = _Segment.compare(consumer, consumee);
        if (cmp2 === 0) return;
        if (cmp2 > 0) {
          const tmp = consumer;
          consumer = consumee;
          consumee = tmp;
        }
        if (consumer.prev === consumee) {
          const tmp = consumer;
          consumer = consumee;
          consumee = tmp;
        }
        for (let i = 0, iMax = consumee.rings.length; i < iMax; i++) {
          const ring = consumee.rings[i];
          const winding = consumee.windings[i];
          const index2 = consumer.rings.indexOf(ring);
          if (index2 === -1) {
            consumer.rings.push(ring);
            consumer.windings.push(winding);
          } else consumer.windings[index2] += winding;
        }
        consumee.rings = null;
        consumee.windings = null;
        consumee.consumedBy = consumer;
        consumee.leftSE.consumedBy = consumer.leftSE;
        consumee.rightSE.consumedBy = consumer.rightSE;
      }
      /* The first segment previous segment chain that is in the result */
      prevInResult() {
        if (this._prevInResult !== void 0) return this._prevInResult;
        if (!this.prev) this._prevInResult = null;
        else if (this.prev.isInResult()) this._prevInResult = this.prev;
        else this._prevInResult = this.prev.prevInResult();
        return this._prevInResult;
      }
      beforeState() {
        if (this._beforeState !== void 0) return this._beforeState;
        if (!this.prev) this._beforeState = {
          rings: [],
          windings: [],
          multiPolys: []
        };
        else {
          const seg = this.prev.consumedBy || this.prev;
          this._beforeState = seg.afterState();
        }
        return this._beforeState;
      }
      afterState() {
        if (this._afterState !== void 0) return this._afterState;
        const beforeState = this.beforeState();
        this._afterState = {
          rings: beforeState.rings.slice(0),
          windings: beforeState.windings.slice(0),
          multiPolys: []
        };
        const ringsAfter = this._afterState.rings;
        const windingsAfter = this._afterState.windings;
        const mpsAfter = this._afterState.multiPolys;
        for (let i = 0, iMax = this.rings.length; i < iMax; i++) {
          const ring = this.rings[i];
          const winding = this.windings[i];
          const index2 = ringsAfter.indexOf(ring);
          if (index2 === -1) {
            ringsAfter.push(ring);
            windingsAfter.push(winding);
          } else windingsAfter[index2] += winding;
        }
        const polysAfter = [];
        const polysExclude = [];
        for (let i = 0, iMax = ringsAfter.length; i < iMax; i++) {
          if (windingsAfter[i] === 0) continue;
          const ring = ringsAfter[i];
          const poly = ring.poly;
          if (polysExclude.indexOf(poly) !== -1) continue;
          if (ring.isExterior) polysAfter.push(poly);
          else {
            if (polysExclude.indexOf(poly) === -1) polysExclude.push(poly);
            const index2 = polysAfter.indexOf(ring.poly);
            if (index2 !== -1) polysAfter.splice(index2, 1);
          }
        }
        for (let i = 0, iMax = polysAfter.length; i < iMax; i++) {
          const mp = polysAfter[i].multiPoly;
          if (mpsAfter.indexOf(mp) === -1) mpsAfter.push(mp);
        }
        return this._afterState;
      }
      /* Is this segment part of the final result? */
      isInResult() {
        if (this.consumedBy) return false;
        if (this._isInResult !== void 0) return this._isInResult;
        const mpsBefore = this.beforeState().multiPolys;
        const mpsAfter = this.afterState().multiPolys;
        switch (operation.type) {
          case "union": {
            const noBefores = mpsBefore.length === 0;
            const noAfters = mpsAfter.length === 0;
            this._isInResult = noBefores !== noAfters;
            break;
          }
          case "intersection": {
            let least;
            let most;
            if (mpsBefore.length < mpsAfter.length) {
              least = mpsBefore.length;
              most = mpsAfter.length;
            } else {
              least = mpsAfter.length;
              most = mpsBefore.length;
            }
            this._isInResult = most === operation.numMultiPolys && least < most;
            break;
          }
          case "xor": {
            const diff = Math.abs(mpsBefore.length - mpsAfter.length);
            this._isInResult = diff % 2 === 1;
            break;
          }
          case "difference": {
            const isJustSubject = (mps) => mps.length === 1 && mps[0].isSubject;
            this._isInResult = isJustSubject(mpsBefore) !== isJustSubject(mpsAfter);
            break;
          }
          default:
            throw new Error(`Unrecognized operation type found ${operation.type}`);
        }
        return this._isInResult;
      }
    };
    var RingIn = class {
      constructor(geomRing, poly, isExterior) {
        if (!Array.isArray(geomRing) || geomRing.length === 0) {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        this.poly = poly;
        this.isExterior = isExterior;
        this.segments = [];
        if (typeof geomRing[0][0] !== "number" || typeof geomRing[0][1] !== "number") {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        const firstPoint = rounder.round(geomRing[0][0], geomRing[0][1]);
        this.bbox = {
          ll: {
            x: firstPoint.x,
            y: firstPoint.y
          },
          ur: {
            x: firstPoint.x,
            y: firstPoint.y
          }
        };
        let prevPoint = firstPoint;
        for (let i = 1, iMax = geomRing.length; i < iMax; i++) {
          if (typeof geomRing[i][0] !== "number" || typeof geomRing[i][1] !== "number") {
            throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
          }
          let point = rounder.round(geomRing[i][0], geomRing[i][1]);
          if (point.x === prevPoint.x && point.y === prevPoint.y) continue;
          this.segments.push(Segment.fromRing(prevPoint, point, this));
          if (point.x < this.bbox.ll.x) this.bbox.ll.x = point.x;
          if (point.y < this.bbox.ll.y) this.bbox.ll.y = point.y;
          if (point.x > this.bbox.ur.x) this.bbox.ur.x = point.x;
          if (point.y > this.bbox.ur.y) this.bbox.ur.y = point.y;
          prevPoint = point;
        }
        if (firstPoint.x !== prevPoint.x || firstPoint.y !== prevPoint.y) {
          this.segments.push(Segment.fromRing(prevPoint, firstPoint, this));
        }
      }
      getSweepEvents() {
        const sweepEvents = [];
        for (let i = 0, iMax = this.segments.length; i < iMax; i++) {
          const segment = this.segments[i];
          sweepEvents.push(segment.leftSE);
          sweepEvents.push(segment.rightSE);
        }
        return sweepEvents;
      }
    };
    var PolyIn = class {
      constructor(geomPoly, multiPoly) {
        if (!Array.isArray(geomPoly)) {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        this.exteriorRing = new RingIn(geomPoly[0], this, true);
        this.bbox = {
          ll: {
            x: this.exteriorRing.bbox.ll.x,
            y: this.exteriorRing.bbox.ll.y
          },
          ur: {
            x: this.exteriorRing.bbox.ur.x,
            y: this.exteriorRing.bbox.ur.y
          }
        };
        this.interiorRings = [];
        for (let i = 1, iMax = geomPoly.length; i < iMax; i++) {
          const ring = new RingIn(geomPoly[i], this, false);
          if (ring.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = ring.bbox.ll.x;
          if (ring.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = ring.bbox.ll.y;
          if (ring.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = ring.bbox.ur.x;
          if (ring.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = ring.bbox.ur.y;
          this.interiorRings.push(ring);
        }
        this.multiPoly = multiPoly;
      }
      getSweepEvents() {
        const sweepEvents = this.exteriorRing.getSweepEvents();
        for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
          const ringSweepEvents = this.interiorRings[i].getSweepEvents();
          for (let j = 0, jMax = ringSweepEvents.length; j < jMax; j++) {
            sweepEvents.push(ringSweepEvents[j]);
          }
        }
        return sweepEvents;
      }
    };
    var MultiPolyIn = class {
      constructor(geom, isSubject) {
        if (!Array.isArray(geom)) {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        try {
          if (typeof geom[0][0][0] === "number") geom = [geom];
        } catch (ex) {
        }
        this.polys = [];
        this.bbox = {
          ll: {
            x: Number.POSITIVE_INFINITY,
            y: Number.POSITIVE_INFINITY
          },
          ur: {
            x: Number.NEGATIVE_INFINITY,
            y: Number.NEGATIVE_INFINITY
          }
        };
        for (let i = 0, iMax = geom.length; i < iMax; i++) {
          const poly = new PolyIn(geom[i], this);
          if (poly.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = poly.bbox.ll.x;
          if (poly.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = poly.bbox.ll.y;
          if (poly.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = poly.bbox.ur.x;
          if (poly.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = poly.bbox.ur.y;
          this.polys.push(poly);
        }
        this.isSubject = isSubject;
      }
      getSweepEvents() {
        const sweepEvents = [];
        for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
          const polySweepEvents = this.polys[i].getSweepEvents();
          for (let j = 0, jMax = polySweepEvents.length; j < jMax; j++) {
            sweepEvents.push(polySweepEvents[j]);
          }
        }
        return sweepEvents;
      }
    };
    var RingOut = class _RingOut {
      /* Given the segments from the sweep line pass, compute & return a series
       * of closed rings from all the segments marked to be part of the result */
      static factory(allSegments) {
        const ringsOut = [];
        for (let i = 0, iMax = allSegments.length; i < iMax; i++) {
          const segment = allSegments[i];
          if (!segment.isInResult() || segment.ringOut) continue;
          let prevEvent = null;
          let event = segment.leftSE;
          let nextEvent = segment.rightSE;
          const events = [event];
          const startingPoint = event.point;
          const intersectionLEs = [];
          while (true) {
            prevEvent = event;
            event = nextEvent;
            events.push(event);
            if (event.point === startingPoint) break;
            while (true) {
              const availableLEs = event.getAvailableLinkedEvents();
              if (availableLEs.length === 0) {
                const firstPt = events[0].point;
                const lastPt = events[events.length - 1].point;
                throw new Error(`Unable to complete output ring starting at [${firstPt.x}, ${firstPt.y}]. Last matching segment found ends at [${lastPt.x}, ${lastPt.y}].`);
              }
              if (availableLEs.length === 1) {
                nextEvent = availableLEs[0].otherSE;
                break;
              }
              let indexLE = null;
              for (let j = 0, jMax = intersectionLEs.length; j < jMax; j++) {
                if (intersectionLEs[j].point === event.point) {
                  indexLE = j;
                  break;
                }
              }
              if (indexLE !== null) {
                const intersectionLE = intersectionLEs.splice(indexLE)[0];
                const ringEvents = events.splice(intersectionLE.index);
                ringEvents.unshift(ringEvents[0].otherSE);
                ringsOut.push(new _RingOut(ringEvents.reverse()));
                continue;
              }
              intersectionLEs.push({
                index: events.length,
                point: event.point
              });
              const comparator = event.getLeftmostComparator(prevEvent);
              nextEvent = availableLEs.sort(comparator)[0].otherSE;
              break;
            }
          }
          ringsOut.push(new _RingOut(events));
        }
        return ringsOut;
      }
      constructor(events) {
        this.events = events;
        for (let i = 0, iMax = events.length; i < iMax; i++) {
          events[i].segment.ringOut = this;
        }
        this.poly = null;
      }
      getGeom() {
        let prevPt = this.events[0].point;
        const points = [prevPt];
        for (let i = 1, iMax = this.events.length - 1; i < iMax; i++) {
          const pt2 = this.events[i].point;
          const nextPt2 = this.events[i + 1].point;
          if (compareVectorAngles(pt2, prevPt, nextPt2) === 0) continue;
          points.push(pt2);
          prevPt = pt2;
        }
        if (points.length === 1) return null;
        const pt = points[0];
        const nextPt = points[1];
        if (compareVectorAngles(pt, prevPt, nextPt) === 0) points.shift();
        points.push(points[0]);
        const step = this.isExteriorRing() ? 1 : -1;
        const iStart = this.isExteriorRing() ? 0 : points.length - 1;
        const iEnd = this.isExteriorRing() ? points.length : -1;
        const orderedPoints = [];
        for (let i = iStart; i != iEnd; i += step) orderedPoints.push([points[i].x, points[i].y]);
        return orderedPoints;
      }
      isExteriorRing() {
        if (this._isExteriorRing === void 0) {
          const enclosing = this.enclosingRing();
          this._isExteriorRing = enclosing ? !enclosing.isExteriorRing() : true;
        }
        return this._isExteriorRing;
      }
      enclosingRing() {
        if (this._enclosingRing === void 0) {
          this._enclosingRing = this._calcEnclosingRing();
        }
        return this._enclosingRing;
      }
      /* Returns the ring that encloses this one, if any */
      _calcEnclosingRing() {
        let leftMostEvt = this.events[0];
        for (let i = 1, iMax = this.events.length; i < iMax; i++) {
          const evt = this.events[i];
          if (SweepEvent.compare(leftMostEvt, evt) > 0) leftMostEvt = evt;
        }
        let prevSeg = leftMostEvt.segment.prevInResult();
        let prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
        while (true) {
          if (!prevSeg) return null;
          if (!prevPrevSeg) return prevSeg.ringOut;
          if (prevPrevSeg.ringOut !== prevSeg.ringOut) {
            if (prevPrevSeg.ringOut.enclosingRing() !== prevSeg.ringOut) {
              return prevSeg.ringOut;
            } else return prevSeg.ringOut.enclosingRing();
          }
          prevSeg = prevPrevSeg.prevInResult();
          prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
        }
      }
    };
    var PolyOut = class {
      constructor(exteriorRing) {
        this.exteriorRing = exteriorRing;
        exteriorRing.poly = this;
        this.interiorRings = [];
      }
      addInterior(ring) {
        this.interiorRings.push(ring);
        ring.poly = this;
      }
      getGeom() {
        const geom = [this.exteriorRing.getGeom()];
        if (geom[0] === null) return null;
        for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
          const ringGeom = this.interiorRings[i].getGeom();
          if (ringGeom === null) continue;
          geom.push(ringGeom);
        }
        return geom;
      }
    };
    var MultiPolyOut = class {
      constructor(rings) {
        this.rings = rings;
        this.polys = this._composePolys(rings);
      }
      getGeom() {
        const geom = [];
        for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
          const polyGeom = this.polys[i].getGeom();
          if (polyGeom === null) continue;
          geom.push(polyGeom);
        }
        return geom;
      }
      _composePolys(rings) {
        const polys = [];
        for (let i = 0, iMax = rings.length; i < iMax; i++) {
          const ring = rings[i];
          if (ring.poly) continue;
          if (ring.isExteriorRing()) polys.push(new PolyOut(ring));
          else {
            const enclosingRing = ring.enclosingRing();
            if (!enclosingRing.poly) polys.push(new PolyOut(enclosingRing));
            enclosingRing.poly.addInterior(ring);
          }
        }
        return polys;
      }
    };
    var SweepLine = class {
      constructor(queue) {
        let comparator = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : Segment.compare;
        this.queue = queue;
        this.tree = new SplayTree__default["default"](comparator);
        this.segments = [];
      }
      process(event) {
        const segment = event.segment;
        const newEvents = [];
        if (event.consumedBy) {
          if (event.isLeft) this.queue.remove(event.otherSE);
          else this.tree.remove(segment);
          return newEvents;
        }
        const node = event.isLeft ? this.tree.add(segment) : this.tree.find(segment);
        if (!node) throw new Error(`Unable to find segment #${segment.id} [${segment.leftSE.point.x}, ${segment.leftSE.point.y}] -> [${segment.rightSE.point.x}, ${segment.rightSE.point.y}] in SweepLine tree.`);
        let prevNode = node;
        let nextNode = node;
        let prevSeg = void 0;
        let nextSeg = void 0;
        while (prevSeg === void 0) {
          prevNode = this.tree.prev(prevNode);
          if (prevNode === null) prevSeg = null;
          else if (prevNode.key.consumedBy === void 0) prevSeg = prevNode.key;
        }
        while (nextSeg === void 0) {
          nextNode = this.tree.next(nextNode);
          if (nextNode === null) nextSeg = null;
          else if (nextNode.key.consumedBy === void 0) nextSeg = nextNode.key;
        }
        if (event.isLeft) {
          let prevMySplitter = null;
          if (prevSeg) {
            const prevInter = prevSeg.getIntersection(segment);
            if (prevInter !== null) {
              if (!segment.isAnEndpoint(prevInter)) prevMySplitter = prevInter;
              if (!prevSeg.isAnEndpoint(prevInter)) {
                const newEventsFromSplit = this._splitSafely(prevSeg, prevInter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
            }
          }
          let nextMySplitter = null;
          if (nextSeg) {
            const nextInter = nextSeg.getIntersection(segment);
            if (nextInter !== null) {
              if (!segment.isAnEndpoint(nextInter)) nextMySplitter = nextInter;
              if (!nextSeg.isAnEndpoint(nextInter)) {
                const newEventsFromSplit = this._splitSafely(nextSeg, nextInter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
            }
          }
          if (prevMySplitter !== null || nextMySplitter !== null) {
            let mySplitter = null;
            if (prevMySplitter === null) mySplitter = nextMySplitter;
            else if (nextMySplitter === null) mySplitter = prevMySplitter;
            else {
              const cmpSplitters = SweepEvent.comparePoints(prevMySplitter, nextMySplitter);
              mySplitter = cmpSplitters <= 0 ? prevMySplitter : nextMySplitter;
            }
            this.queue.remove(segment.rightSE);
            newEvents.push(segment.rightSE);
            const newEventsFromSplit = segment.split(mySplitter);
            for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
              newEvents.push(newEventsFromSplit[i]);
            }
          }
          if (newEvents.length > 0) {
            this.tree.remove(segment);
            newEvents.push(event);
          } else {
            this.segments.push(segment);
            segment.prev = prevSeg;
          }
        } else {
          if (prevSeg && nextSeg) {
            const inter = prevSeg.getIntersection(nextSeg);
            if (inter !== null) {
              if (!prevSeg.isAnEndpoint(inter)) {
                const newEventsFromSplit = this._splitSafely(prevSeg, inter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
              if (!nextSeg.isAnEndpoint(inter)) {
                const newEventsFromSplit = this._splitSafely(nextSeg, inter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
            }
          }
          this.tree.remove(segment);
        }
        return newEvents;
      }
      /* Safely split a segment that is currently in the datastructures
       * IE - a segment other than the one that is currently being processed. */
      _splitSafely(seg, pt) {
        this.tree.remove(seg);
        const rightSE = seg.rightSE;
        this.queue.remove(rightSE);
        const newEvents = seg.split(pt);
        newEvents.push(rightSE);
        if (seg.consumedBy === void 0) this.tree.add(seg);
        return newEvents;
      }
    };
    var POLYGON_CLIPPING_MAX_QUEUE_SIZE = typeof process !== "undefined" && process.env.POLYGON_CLIPPING_MAX_QUEUE_SIZE || 1e6;
    var POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS = typeof process !== "undefined" && process.env.POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS || 1e6;
    var Operation = class {
      run(type, geom, moreGeoms) {
        operation.type = type;
        rounder.reset();
        const multipolys = [new MultiPolyIn(geom, true)];
        for (let i = 0, iMax = moreGeoms.length; i < iMax; i++) {
          multipolys.push(new MultiPolyIn(moreGeoms[i], false));
        }
        operation.numMultiPolys = multipolys.length;
        if (operation.type === "difference") {
          const subject = multipolys[0];
          let i = 1;
          while (i < multipolys.length) {
            if (getBboxOverlap(multipolys[i].bbox, subject.bbox) !== null) i++;
            else multipolys.splice(i, 1);
          }
        }
        if (operation.type === "intersection") {
          for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
            const mpA = multipolys[i];
            for (let j = i + 1, jMax = multipolys.length; j < jMax; j++) {
              if (getBboxOverlap(mpA.bbox, multipolys[j].bbox) === null) return [];
            }
          }
        }
        const queue = new SplayTree__default["default"](SweepEvent.compare);
        for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
          const sweepEvents = multipolys[i].getSweepEvents();
          for (let j = 0, jMax = sweepEvents.length; j < jMax; j++) {
            queue.insert(sweepEvents[j]);
            if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
              throw new Error("Infinite loop when putting segment endpoints in a priority queue (queue size too big).");
            }
          }
        }
        const sweepLine = new SweepLine(queue);
        let prevQueueSize = queue.size;
        let node = queue.pop();
        while (node) {
          const evt = node.key;
          if (queue.size === prevQueueSize) {
            const seg = evt.segment;
            throw new Error(`Unable to pop() ${evt.isLeft ? "left" : "right"} SweepEvent [${evt.point.x}, ${evt.point.y}] from segment #${seg.id} [${seg.leftSE.point.x}, ${seg.leftSE.point.y}] -> [${seg.rightSE.point.x}, ${seg.rightSE.point.y}] from queue.`);
          }
          if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
            throw new Error("Infinite loop when passing sweep line over endpoints (queue size too big).");
          }
          if (sweepLine.segments.length > POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS) {
            throw new Error("Infinite loop when passing sweep line over endpoints (too many sweep line segments).");
          }
          const newEvents = sweepLine.process(evt);
          for (let i = 0, iMax = newEvents.length; i < iMax; i++) {
            const evt2 = newEvents[i];
            if (evt2.consumedBy === void 0) queue.insert(evt2);
          }
          prevQueueSize = queue.size;
          node = queue.pop();
        }
        rounder.reset();
        const ringsOut = RingOut.factory(sweepLine.segments);
        const result = new MultiPolyOut(ringsOut);
        return result.getGeom();
      }
    };
    var operation = new Operation();
    var union = function(geom) {
      for (var _len = arguments.length, moreGeoms = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        moreGeoms[_key - 1] = arguments[_key];
      }
      return operation.run("union", geom, moreGeoms);
    };
    var intersection = function(geom) {
      for (var _len2 = arguments.length, moreGeoms = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        moreGeoms[_key2 - 1] = arguments[_key2];
      }
      return operation.run("intersection", geom, moreGeoms);
    };
    var xor = function(geom) {
      for (var _len3 = arguments.length, moreGeoms = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        moreGeoms[_key3 - 1] = arguments[_key3];
      }
      return operation.run("xor", geom, moreGeoms);
    };
    var difference = function(subjectGeom) {
      for (var _len4 = arguments.length, clippingGeoms = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
        clippingGeoms[_key4 - 1] = arguments[_key4];
      }
      return operation.run("difference", subjectGeom, clippingGeoms);
    };
    var index = {
      union,
      intersection,
      xor,
      difference
    };
    module.exports = index;
  }
});

// node_modules/splaytree/dist/splaytree.umd.cjs
var require_splaytree_umd2 = __commonJS({
  "node_modules/splaytree/dist/splaytree.umd.cjs"(exports, module) {
    (function(h, c) {
      typeof exports == "object" && typeof module < "u" ? module.exports = c() : typeof define == "function" && define.amd ? define(c) : (h = typeof globalThis < "u" ? globalThis : h || self, h.SplayTree = c());
    })(exports, (function() {
      "use strict";
      class h {
        constructor(t, e) {
          this.next = null, this.key = t, this.data = e, this.left = null, this.right = null;
        }
      }
      function c(n, t) {
        return n > t ? 1 : n < t ? -1 : 0;
      }
      function u(n, t, e) {
        const r = new h(null, null);
        let i = r, l = r;
        for (; ; ) {
          const o = e(n, t.key);
          if (o < 0) {
            if (t.left === null) break;
            if (e(n, t.left.key) < 0) {
              const s = t.left;
              if (t.left = s.right, s.right = t, t = s, t.left === null) break;
            }
            l.left = t, l = t, t = t.left;
          } else if (o > 0) {
            if (t.right === null) break;
            if (e(n, t.right.key) > 0) {
              const s = t.right;
              if (t.right = s.left, s.left = t, t = s, t.right === null) break;
            }
            i.right = t, i = t, t = t.right;
          } else break;
        }
        return i.right = t.left, l.left = t.right, t.left = r.right, t.right = r.left, t;
      }
      function _(n, t, e, r) {
        const i = new h(n, t);
        if (e === null) return i.left = i.right = null, i;
        e = u(n, e, r);
        const l = r(n, e.key);
        return l < 0 ? (i.left = e.left, i.right = e, e.left = null) : l >= 0 && (i.right = e.right, i.left = e, e.right = null), i;
      }
      function d(n, t, e) {
        let r = null, i = null;
        if (t) {
          t = u(n, t, e);
          const l = e(t.key, n);
          l === 0 ? (r = t.left, i = t.right) : l < 0 ? (i = t.right, t.right = null, r = t) : (r = t.left, t.left = null, i = t);
        }
        return { left: r, right: i };
      }
      function w(n, t, e) {
        return t === null ? n : (n === null || (t = u(n.key, t, e), t.left = n), t);
      }
      function a(n, t, e, r, i) {
        if (n) {
          r(`${t}${e ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 "}${i(n)}
`);
          const l = t + (e ? "    " : "\u2502   ");
          n.left && a(n.left, l, false, r, i), n.right && a(n.right, l, true, r, i);
        }
      }
      class x {
        constructor(t = c) {
          this._root = null, this._size = 0, this._comparator = t;
        }
        insert(t, e) {
          return this._size++, this._root = _(t, e, this._root, this._comparator);
        }
        add(t, e) {
          const r = new h(t, e);
          this._root === null && (r.left = r.right = null, this._size++, this._root = r);
          const i = this._comparator, l = u(t, this._root, i), o = i(t, l.key);
          return o === 0 ? this._root = l : (o < 0 ? (r.left = l.left, r.right = l, l.left = null) : o > 0 && (r.right = l.right, r.left = l, l.right = null), this._size++, this._root = r), this._root;
        }
        remove(t) {
          this._root = this._remove(t, this._root, this._comparator);
        }
        _remove(t, e, r) {
          let i;
          return e === null ? null : (e = u(t, e, r), r(t, e.key) === 0 ? (e.left === null ? i = e.right : (i = u(t, e.left, r), i.right = e.right), this._size--, i) : e);
        }
        pop() {
          let t = this._root;
          if (t) {
            for (; t.left; ) t = t.left;
            return this._root = u(t.key, this._root, this._comparator), this._root = this._remove(t.key, this._root, this._comparator), { key: t.key, data: t.data };
          }
          return null;
        }
        findStatic(t) {
          let e = this._root;
          const r = this._comparator;
          for (; e; ) {
            const i = r(t, e.key);
            if (i === 0) return e;
            i < 0 ? e = e.left : e = e.right;
          }
          return null;
        }
        find(t) {
          return this._root && (this._root = u(t, this._root, this._comparator), this._comparator(t, this._root.key) !== 0) ? null : this._root;
        }
        contains(t) {
          let e = this._root;
          const r = this._comparator;
          for (; e; ) {
            const i = r(t, e.key);
            if (i === 0) return true;
            i < 0 ? e = e.left : e = e.right;
          }
          return false;
        }
        forEach(t, e) {
          let r = this._root;
          const i = [];
          let l = false;
          for (; !l; ) r !== null ? (i.push(r), r = r.left) : i.length !== 0 ? (r = i.pop(), t.call(e, r), r = r.right) : l = true;
          return this;
        }
        range(t, e, r, i) {
          const l = [], o = this._comparator;
          let s = this._root, f;
          for (; l.length !== 0 || s; ) if (s) l.push(s), s = s.left;
          else {
            if (s = l.pop(), f = o(s.key, e), f > 0) break;
            if (o(s.key, t) >= 0 && r.call(i, s)) return this;
            s = s.right;
          }
          return this;
        }
        keys() {
          const t = [];
          return this.forEach(({ key: e }) => {
            t.push(e);
          }), t;
        }
        values() {
          const t = [];
          return this.forEach(({ data: e }) => {
            t.push(e);
          }), t;
        }
        min() {
          return this._root ? this.minNode(this._root).key : null;
        }
        max() {
          return this._root ? this.maxNode(this._root).key : null;
        }
        minNode(t = this._root) {
          if (t) for (; t.left; ) t = t.left;
          return t;
        }
        maxNode(t = this._root) {
          if (t) for (; t.right; ) t = t.right;
          return t;
        }
        at(t) {
          let e = this._root, r = false, i = 0;
          const l = [];
          for (; !r; ) if (e) l.push(e), e = e.left;
          else if (l.length > 0) {
            if (e = l.pop(), i === t) return e;
            i++, e = e.right;
          } else r = true;
          return null;
        }
        next(t) {
          let e = this._root, r = null;
          if (t.right) {
            for (r = t.right; r.left; ) r = r.left;
            return r;
          }
          const i = this._comparator;
          for (; e; ) {
            const l = i(t.key, e.key);
            if (l === 0) break;
            l < 0 ? (r = e, e = e.left) : e = e.right;
          }
          return r;
        }
        prev(t) {
          let e = this._root, r = null;
          if (t.left !== null) {
            for (r = t.left; r.right; ) r = r.right;
            return r;
          }
          const i = this._comparator;
          for (; e; ) {
            const l = i(t.key, e.key);
            if (l === 0) break;
            l < 0 ? e = e.left : (r = e, e = e.right);
          }
          return r;
        }
        clear() {
          return this._root = null, this._size = 0, this;
        }
        toList() {
          return y(this._root);
        }
        load(t, e = [], r = false) {
          let i = t.length;
          const l = this._comparator;
          if (r && m(t, e, 0, i - 1, l), this._root === null) this._root = p(t, e, 0, i), this._size = i;
          else {
            const o = z(this.toList(), k(t, e), l);
            i = this._size + i, this._root = g({ head: o }, 0, i);
          }
          return this;
        }
        isEmpty() {
          return this._root === null;
        }
        get size() {
          return this._size;
        }
        get root() {
          return this._root;
        }
        toString(t = (e) => String(e.key)) {
          const e = [];
          return a(this._root, "", true, (r) => e.push(r), t), e.join("");
        }
        update(t, e, r) {
          const i = this._comparator;
          let { left: l, right: o } = d(t, this._root, i);
          i(t, e) < 0 ? o = _(e, r, o, i) : l = _(e, r, l, i), this._root = w(l, o, i);
        }
        split(t) {
          return d(t, this._root, this._comparator);
        }
        *[Symbol.iterator]() {
          let t = this._root;
          const e = [];
          let r = false;
          for (; !r; ) t !== null ? (e.push(t), t = t.left) : e.length !== 0 ? (t = e.pop(), yield t, t = t.right) : r = true;
        }
      }
      function p(n, t, e, r) {
        const i = r - e;
        if (i > 0) {
          const l = e + Math.floor(i / 2), o = n[l], s = t[l], f = new h(o, s);
          return f.left = p(n, t, e, l), f.right = p(n, t, l + 1, r), f;
        }
        return null;
      }
      function k(n, t) {
        const e = new h(null, null);
        let r = e;
        for (let i = 0; i < n.length; i++) r = r.next = new h(n[i], t[i]);
        return r.next = null, e.next;
      }
      function y(n) {
        let t = n;
        const e = [];
        let r = false;
        const i = new h(null, null);
        let l = i;
        for (; !r; ) t ? (e.push(t), t = t.left) : e.length > 0 ? (t = l = l.next = e.pop(), t = t.right) : r = true;
        return l.next = null, i.next;
      }
      function g(n, t, e) {
        const r = e - t;
        if (r > 0) {
          const i = t + Math.floor(r / 2), l = g(n, t, i), o = n.head;
          return o.left = l, n.head = n.head.next, o.right = g(n, i + 1, e), o;
        }
        return null;
      }
      function z(n, t, e) {
        const r = new h(null, null);
        let i = r, l = n, o = t;
        for (; l !== null && o !== null; ) e(l.key, o.key) < 0 ? (i.next = l, l = l.next) : (i.next = o, o = o.next), i = i.next;
        return l !== null ? i.next = l : o !== null && (i.next = o), r.next;
      }
      function m(n, t, e, r, i) {
        if (e >= r) return;
        const l = n[e + r >> 1];
        let o = e - 1, s = r + 1;
        for (; ; ) {
          do
            o++;
          while (i(n[o], l) < 0);
          do
            s--;
          while (i(n[s], l) > 0);
          if (o >= s) break;
          let f = n[o];
          n[o] = n[s], n[s] = f, f = t[o], t[o] = t[s], t[s] = f;
        }
        m(n, t, e, s, i), m(n, t, s + 1, r, i);
      }
      return x;
    }));
  }
});

// node_modules/polygon-clipping/dist/polygon-clipping.cjs.js
var require_polygon_clipping_cjs2 = __commonJS({
  "node_modules/polygon-clipping/dist/polygon-clipping.cjs.js"(exports, module) {
    "use strict";
    var SplayTree = require_splaytree_umd2();
    function _interopDefaultLegacy(e) {
      return e && typeof e === "object" && "default" in e ? e : { "default": e };
    }
    var SplayTree__default = /* @__PURE__ */ _interopDefaultLegacy(SplayTree);
    var isInBbox = (bbox, point) => {
      return bbox.ll.x <= point.x && point.x <= bbox.ur.x && bbox.ll.y <= point.y && point.y <= bbox.ur.y;
    };
    var getBboxOverlap = (b1, b2) => {
      if (b2.ur.x < b1.ll.x || b1.ur.x < b2.ll.x || b2.ur.y < b1.ll.y || b1.ur.y < b2.ll.y) return null;
      const lowerX = b1.ll.x < b2.ll.x ? b2.ll.x : b1.ll.x;
      const upperX = b1.ur.x < b2.ur.x ? b1.ur.x : b2.ur.x;
      const lowerY = b1.ll.y < b2.ll.y ? b2.ll.y : b1.ll.y;
      const upperY = b1.ur.y < b2.ur.y ? b1.ur.y : b2.ur.y;
      return {
        ll: {
          x: lowerX,
          y: lowerY
        },
        ur: {
          x: upperX,
          y: upperY
        }
      };
    };
    var epsilon$1 = Number.EPSILON;
    if (epsilon$1 === void 0) epsilon$1 = Math.pow(2, -52);
    var EPSILON_SQ = epsilon$1 * epsilon$1;
    var cmp = (a, b) => {
      if (-epsilon$1 < a && a < epsilon$1) {
        if (-epsilon$1 < b && b < epsilon$1) {
          return 0;
        }
      }
      const ab = a - b;
      if (ab * ab < EPSILON_SQ * a * b) {
        return 0;
      }
      return a < b ? -1 : 1;
    };
    var PtRounder = class {
      constructor() {
        this.reset();
      }
      reset() {
        this.xRounder = new CoordRounder();
        this.yRounder = new CoordRounder();
      }
      round(x, y) {
        return {
          x: this.xRounder.round(x),
          y: this.yRounder.round(y)
        };
      }
    };
    var CoordRounder = class {
      constructor() {
        this.tree = new SplayTree__default["default"]();
        this.round(0);
      }
      // Note: this can rounds input values backwards or forwards.
      //       You might ask, why not restrict this to just rounding
      //       forwards? Wouldn't that allow left endpoints to always
      //       remain left endpoints during splitting (never change to
      //       right). No - it wouldn't, because we snap intersections
      //       to endpoints (to establish independence from the segment
      //       angle for t-intersections).
      round(coord) {
        const node = this.tree.add(coord);
        const prevNode = this.tree.prev(node);
        if (prevNode !== null && cmp(node.key, prevNode.key) === 0) {
          this.tree.remove(coord);
          return prevNode.key;
        }
        const nextNode = this.tree.next(node);
        if (nextNode !== null && cmp(node.key, nextNode.key) === 0) {
          this.tree.remove(coord);
          return nextNode.key;
        }
        return coord;
      }
    };
    var rounder = new PtRounder();
    var epsilon = 11102230246251565e-32;
    var splitter = 134217729;
    var resulterrbound = (3 + 8 * epsilon) * epsilon;
    function sum(elen, e, flen, f, h) {
      let Q, Qnew, hh, bvirt;
      let enow = e[0];
      let fnow = f[0];
      let eindex = 0;
      let findex = 0;
      if (fnow > enow === fnow > -enow) {
        Q = enow;
        enow = e[++eindex];
      } else {
        Q = fnow;
        fnow = f[++findex];
      }
      let hindex = 0;
      if (eindex < elen && findex < flen) {
        if (fnow > enow === fnow > -enow) {
          Qnew = enow + Q;
          hh = Q - (Qnew - enow);
          enow = e[++eindex];
        } else {
          Qnew = fnow + Q;
          hh = Q - (Qnew - fnow);
          fnow = f[++findex];
        }
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
        while (eindex < elen && findex < flen) {
          if (fnow > enow === fnow > -enow) {
            Qnew = Q + enow;
            bvirt = Qnew - Q;
            hh = Q - (Qnew - bvirt) + (enow - bvirt);
            enow = e[++eindex];
          } else {
            Qnew = Q + fnow;
            bvirt = Qnew - Q;
            hh = Q - (Qnew - bvirt) + (fnow - bvirt);
            fnow = f[++findex];
          }
          Q = Qnew;
          if (hh !== 0) {
            h[hindex++] = hh;
          }
        }
      }
      while (eindex < elen) {
        Qnew = Q + enow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (enow - bvirt);
        enow = e[++eindex];
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
      }
      while (findex < flen) {
        Qnew = Q + fnow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (fnow - bvirt);
        fnow = f[++findex];
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
      }
      if (Q !== 0 || hindex === 0) {
        h[hindex++] = Q;
      }
      return hindex;
    }
    function estimate(elen, e) {
      let Q = e[0];
      for (let i = 1; i < elen; i++) Q += e[i];
      return Q;
    }
    function vec(n) {
      return new Float64Array(n);
    }
    var ccwerrboundA = (3 + 16 * epsilon) * epsilon;
    var ccwerrboundB = (2 + 12 * epsilon) * epsilon;
    var ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;
    var B = vec(4);
    var C1 = vec(8);
    var C2 = vec(12);
    var D = vec(16);
    var u = vec(4);
    function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
      let acxtail, acytail, bcxtail, bcytail;
      let bvirt, c, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u3;
      const acx = ax - cx;
      const bcx = bx - cx;
      const acy = ay - cy;
      const bcy = by - cy;
      s1 = acx * bcy;
      c = splitter * acx;
      ahi = c - (c - acx);
      alo = acx - ahi;
      c = splitter * bcy;
      bhi = c - (c - bcy);
      blo = bcy - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acy * bcx;
      c = splitter * acy;
      ahi = c - (c - acy);
      alo = acy - ahi;
      c = splitter * bcx;
      bhi = c - (c - bcx);
      blo = bcx - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      B[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      B[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      B[2] = _j - (u3 - bvirt) + (_i - bvirt);
      B[3] = u3;
      let det = estimate(4, B);
      let errbound = ccwerrboundB * detsum;
      if (det >= errbound || -det >= errbound) {
        return det;
      }
      bvirt = ax - acx;
      acxtail = ax - (acx + bvirt) + (bvirt - cx);
      bvirt = bx - bcx;
      bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
      bvirt = ay - acy;
      acytail = ay - (acy + bvirt) + (bvirt - cy);
      bvirt = by - bcy;
      bcytail = by - (bcy + bvirt) + (bvirt - cy);
      if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
        return det;
      }
      errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
      det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
      if (det >= errbound || -det >= errbound) return det;
      s1 = acxtail * bcy;
      c = splitter * acxtail;
      ahi = c - (c - acxtail);
      alo = acxtail - ahi;
      c = splitter * bcy;
      bhi = c - (c - bcy);
      blo = bcy - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acytail * bcx;
      c = splitter * acytail;
      ahi = c - (c - acytail);
      alo = acytail - ahi;
      c = splitter * bcx;
      bhi = c - (c - bcx);
      blo = bcx - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      u[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      u[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      u[2] = _j - (u3 - bvirt) + (_i - bvirt);
      u[3] = u3;
      const C1len = sum(4, B, 4, u, C1);
      s1 = acx * bcytail;
      c = splitter * acx;
      ahi = c - (c - acx);
      alo = acx - ahi;
      c = splitter * bcytail;
      bhi = c - (c - bcytail);
      blo = bcytail - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acy * bcxtail;
      c = splitter * acy;
      ahi = c - (c - acy);
      alo = acy - ahi;
      c = splitter * bcxtail;
      bhi = c - (c - bcxtail);
      blo = bcxtail - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      u[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      u[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      u[2] = _j - (u3 - bvirt) + (_i - bvirt);
      u[3] = u3;
      const C2len = sum(C1len, C1, 4, u, C2);
      s1 = acxtail * bcytail;
      c = splitter * acxtail;
      ahi = c - (c - acxtail);
      alo = acxtail - ahi;
      c = splitter * bcytail;
      bhi = c - (c - bcytail);
      blo = bcytail - bhi;
      s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
      t1 = acytail * bcxtail;
      c = splitter * acytail;
      ahi = c - (c - acytail);
      alo = acytail - ahi;
      c = splitter * bcxtail;
      bhi = c - (c - bcxtail);
      blo = bcxtail - bhi;
      t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
      _i = s0 - t0;
      bvirt = s0 - _i;
      u[0] = s0 - (_i + bvirt) + (bvirt - t0);
      _j = s1 + _i;
      bvirt = _j - s1;
      _0 = s1 - (_j - bvirt) + (_i - bvirt);
      _i = _0 - t1;
      bvirt = _0 - _i;
      u[1] = _0 - (_i + bvirt) + (bvirt - t1);
      u3 = _j + _i;
      bvirt = u3 - _j;
      u[2] = _j - (u3 - bvirt) + (_i - bvirt);
      u[3] = u3;
      const Dlen = sum(C2len, C2, 4, u, D);
      return D[Dlen - 1];
    }
    function orient2d(ax, ay, bx, by, cx, cy) {
      const detleft = (ay - cy) * (bx - cx);
      const detright = (ax - cx) * (by - cy);
      const det = detleft - detright;
      const detsum = Math.abs(detleft + detright);
      if (Math.abs(det) >= ccwerrboundA * detsum) return det;
      return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
    }
    var crossProduct = (a, b) => a.x * b.y - a.y * b.x;
    var dotProduct = (a, b) => a.x * b.x + a.y * b.y;
    var compareVectorAngles = (basePt, endPt1, endPt2) => {
      const res = orient2d(basePt.x, basePt.y, endPt1.x, endPt1.y, endPt2.x, endPt2.y);
      if (res > 0) return -1;
      if (res < 0) return 1;
      return 0;
    };
    var length = (v) => Math.sqrt(dotProduct(v, v));
    var sineOfAngle = (pShared, pBase, pAngle) => {
      const vBase = {
        x: pBase.x - pShared.x,
        y: pBase.y - pShared.y
      };
      const vAngle = {
        x: pAngle.x - pShared.x,
        y: pAngle.y - pShared.y
      };
      return crossProduct(vAngle, vBase) / length(vAngle) / length(vBase);
    };
    var cosineOfAngle = (pShared, pBase, pAngle) => {
      const vBase = {
        x: pBase.x - pShared.x,
        y: pBase.y - pShared.y
      };
      const vAngle = {
        x: pAngle.x - pShared.x,
        y: pAngle.y - pShared.y
      };
      return dotProduct(vAngle, vBase) / length(vAngle) / length(vBase);
    };
    var horizontalIntersection = (pt, v, y) => {
      if (v.y === 0) return null;
      return {
        x: pt.x + v.x / v.y * (y - pt.y),
        y
      };
    };
    var verticalIntersection = (pt, v, x) => {
      if (v.x === 0) return null;
      return {
        x,
        y: pt.y + v.y / v.x * (x - pt.x)
      };
    };
    var intersection$1 = (pt1, v1, pt2, v2) => {
      if (v1.x === 0) return verticalIntersection(pt2, v2, pt1.x);
      if (v2.x === 0) return verticalIntersection(pt1, v1, pt2.x);
      if (v1.y === 0) return horizontalIntersection(pt2, v2, pt1.y);
      if (v2.y === 0) return horizontalIntersection(pt1, v1, pt2.y);
      const kross = crossProduct(v1, v2);
      if (kross == 0) return null;
      const ve = {
        x: pt2.x - pt1.x,
        y: pt2.y - pt1.y
      };
      const d1 = crossProduct(ve, v1) / kross;
      const d2 = crossProduct(ve, v2) / kross;
      const x1 = pt1.x + d2 * v1.x, x2 = pt2.x + d1 * v2.x;
      const y1 = pt1.y + d2 * v1.y, y2 = pt2.y + d1 * v2.y;
      const x = (x1 + x2) / 2;
      const y = (y1 + y2) / 2;
      return {
        x,
        y
      };
    };
    var SweepEvent = class _SweepEvent {
      // for ordering sweep events in the sweep event queue
      static compare(a, b) {
        const ptCmp = _SweepEvent.comparePoints(a.point, b.point);
        if (ptCmp !== 0) return ptCmp;
        if (a.point !== b.point) a.link(b);
        if (a.isLeft !== b.isLeft) return a.isLeft ? 1 : -1;
        return Segment.compare(a.segment, b.segment);
      }
      // for ordering points in sweep line order
      static comparePoints(aPt, bPt) {
        if (aPt.x < bPt.x) return -1;
        if (aPt.x > bPt.x) return 1;
        if (aPt.y < bPt.y) return -1;
        if (aPt.y > bPt.y) return 1;
        return 0;
      }
      // Warning: 'point' input will be modified and re-used (for performance)
      constructor(point, isLeft) {
        if (point.events === void 0) point.events = [this];
        else point.events.push(this);
        this.point = point;
        this.isLeft = isLeft;
      }
      link(other) {
        if (other.point === this.point) {
          throw new Error("Tried to link already linked events");
        }
        const otherEvents = other.point.events;
        for (let i = 0, iMax = otherEvents.length; i < iMax; i++) {
          const evt = otherEvents[i];
          this.point.events.push(evt);
          evt.point = this.point;
        }
        this.checkForConsuming();
      }
      /* Do a pass over our linked events and check to see if any pair
       * of segments match, and should be consumed. */
      checkForConsuming() {
        const numEvents = this.point.events.length;
        for (let i = 0; i < numEvents; i++) {
          const evt1 = this.point.events[i];
          if (evt1.segment.consumedBy !== void 0) continue;
          for (let j = i + 1; j < numEvents; j++) {
            const evt2 = this.point.events[j];
            if (evt2.consumedBy !== void 0) continue;
            if (evt1.otherSE.point.events !== evt2.otherSE.point.events) continue;
            evt1.segment.consume(evt2.segment);
          }
        }
      }
      getAvailableLinkedEvents() {
        const events = [];
        for (let i = 0, iMax = this.point.events.length; i < iMax; i++) {
          const evt = this.point.events[i];
          if (evt !== this && !evt.segment.ringOut && evt.segment.isInResult()) {
            events.push(evt);
          }
        }
        return events;
      }
      /**
       * Returns a comparator function for sorting linked events that will
       * favor the event that will give us the smallest left-side angle.
       * All ring construction starts as low as possible heading to the right,
       * so by always turning left as sharp as possible we'll get polygons
       * without uncessary loops & holes.
       *
       * The comparator function has a compute cache such that it avoids
       * re-computing already-computed values.
       */
      getLeftmostComparator(baseEvent) {
        const cache = /* @__PURE__ */ new Map();
        const fillCache = (linkedEvent) => {
          const nextEvent = linkedEvent.otherSE;
          cache.set(linkedEvent, {
            sine: sineOfAngle(this.point, baseEvent.point, nextEvent.point),
            cosine: cosineOfAngle(this.point, baseEvent.point, nextEvent.point)
          });
        };
        return (a, b) => {
          if (!cache.has(a)) fillCache(a);
          if (!cache.has(b)) fillCache(b);
          const {
            sine: asine,
            cosine: acosine
          } = cache.get(a);
          const {
            sine: bsine,
            cosine: bcosine
          } = cache.get(b);
          if (asine >= 0 && bsine >= 0) {
            if (acosine < bcosine) return 1;
            if (acosine > bcosine) return -1;
            return 0;
          }
          if (asine < 0 && bsine < 0) {
            if (acosine < bcosine) return -1;
            if (acosine > bcosine) return 1;
            return 0;
          }
          if (bsine < asine) return -1;
          if (bsine > asine) return 1;
          return 0;
        };
      }
    };
    var segmentId = 0;
    var Segment = class _Segment {
      /* This compare() function is for ordering segments in the sweep
       * line tree, and does so according to the following criteria:
       *
       * Consider the vertical line that lies an infinestimal step to the
       * right of the right-more of the two left endpoints of the input
       * segments. Imagine slowly moving a point up from negative infinity
       * in the increasing y direction. Which of the two segments will that
       * point intersect first? That segment comes 'before' the other one.
       *
       * If neither segment would be intersected by such a line, (if one
       * or more of the segments are vertical) then the line to be considered
       * is directly on the right-more of the two left inputs.
       */
      static compare(a, b) {
        const alx = a.leftSE.point.x;
        const blx = b.leftSE.point.x;
        const arx = a.rightSE.point.x;
        const brx = b.rightSE.point.x;
        if (brx < alx) return 1;
        if (arx < blx) return -1;
        const aly = a.leftSE.point.y;
        const bly = b.leftSE.point.y;
        const ary = a.rightSE.point.y;
        const bry = b.rightSE.point.y;
        if (alx < blx) {
          if (bly < aly && bly < ary) return 1;
          if (bly > aly && bly > ary) return -1;
          const aCmpBLeft = a.comparePoint(b.leftSE.point);
          if (aCmpBLeft < 0) return 1;
          if (aCmpBLeft > 0) return -1;
          const bCmpARight = b.comparePoint(a.rightSE.point);
          if (bCmpARight !== 0) return bCmpARight;
          return -1;
        }
        if (alx > blx) {
          if (aly < bly && aly < bry) return -1;
          if (aly > bly && aly > bry) return 1;
          const bCmpALeft = b.comparePoint(a.leftSE.point);
          if (bCmpALeft !== 0) return bCmpALeft;
          const aCmpBRight = a.comparePoint(b.rightSE.point);
          if (aCmpBRight < 0) return 1;
          if (aCmpBRight > 0) return -1;
          return 1;
        }
        if (aly < bly) return -1;
        if (aly > bly) return 1;
        if (arx < brx) {
          const bCmpARight = b.comparePoint(a.rightSE.point);
          if (bCmpARight !== 0) return bCmpARight;
        }
        if (arx > brx) {
          const aCmpBRight = a.comparePoint(b.rightSE.point);
          if (aCmpBRight < 0) return 1;
          if (aCmpBRight > 0) return -1;
        }
        if (arx !== brx) {
          const ay = ary - aly;
          const ax = arx - alx;
          const by = bry - bly;
          const bx = brx - blx;
          if (ay > ax && by < bx) return 1;
          if (ay < ax && by > bx) return -1;
        }
        if (arx > brx) return 1;
        if (arx < brx) return -1;
        if (ary < bry) return -1;
        if (ary > bry) return 1;
        if (a.id < b.id) return -1;
        if (a.id > b.id) return 1;
        return 0;
      }
      /* Warning: a reference to ringWindings input will be stored,
       *  and possibly will be later modified */
      constructor(leftSE, rightSE, rings, windings) {
        this.id = ++segmentId;
        this.leftSE = leftSE;
        leftSE.segment = this;
        leftSE.otherSE = rightSE;
        this.rightSE = rightSE;
        rightSE.segment = this;
        rightSE.otherSE = leftSE;
        this.rings = rings;
        this.windings = windings;
      }
      static fromRing(pt1, pt2, ring) {
        let leftPt, rightPt, winding;
        const cmpPts = SweepEvent.comparePoints(pt1, pt2);
        if (cmpPts < 0) {
          leftPt = pt1;
          rightPt = pt2;
          winding = 1;
        } else if (cmpPts > 0) {
          leftPt = pt2;
          rightPt = pt1;
          winding = -1;
        } else throw new Error(`Tried to create degenerate segment at [${pt1.x}, ${pt1.y}]`);
        const leftSE = new SweepEvent(leftPt, true);
        const rightSE = new SweepEvent(rightPt, false);
        return new _Segment(leftSE, rightSE, [ring], [winding]);
      }
      /* When a segment is split, the rightSE is replaced with a new sweep event */
      replaceRightSE(newRightSE) {
        this.rightSE = newRightSE;
        this.rightSE.segment = this;
        this.rightSE.otherSE = this.leftSE;
        this.leftSE.otherSE = this.rightSE;
      }
      bbox() {
        const y1 = this.leftSE.point.y;
        const y2 = this.rightSE.point.y;
        return {
          ll: {
            x: this.leftSE.point.x,
            y: y1 < y2 ? y1 : y2
          },
          ur: {
            x: this.rightSE.point.x,
            y: y1 > y2 ? y1 : y2
          }
        };
      }
      /* A vector from the left point to the right */
      vector() {
        return {
          x: this.rightSE.point.x - this.leftSE.point.x,
          y: this.rightSE.point.y - this.leftSE.point.y
        };
      }
      isAnEndpoint(pt) {
        return pt.x === this.leftSE.point.x && pt.y === this.leftSE.point.y || pt.x === this.rightSE.point.x && pt.y === this.rightSE.point.y;
      }
      /* Compare this segment with a point.
       *
       * A point P is considered to be colinear to a segment if there
       * exists a distance D such that if we travel along the segment
       * from one * endpoint towards the other a distance D, we find
       * ourselves at point P.
       *
       * Return value indicates:
       *
       *   1: point lies above the segment (to the left of vertical)
       *   0: point is colinear to segment
       *  -1: point lies below the segment (to the right of vertical)
       */
      comparePoint(point) {
        if (this.isAnEndpoint(point)) return 0;
        const lPt = this.leftSE.point;
        const rPt = this.rightSE.point;
        const v = this.vector();
        if (lPt.x === rPt.x) {
          if (point.x === lPt.x) return 0;
          return point.x < lPt.x ? 1 : -1;
        }
        const yDist = (point.y - lPt.y) / v.y;
        const xFromYDist = lPt.x + yDist * v.x;
        if (point.x === xFromYDist) return 0;
        const xDist = (point.x - lPt.x) / v.x;
        const yFromXDist = lPt.y + xDist * v.y;
        if (point.y === yFromXDist) return 0;
        return point.y < yFromXDist ? -1 : 1;
      }
      /**
       * Given another segment, returns the first non-trivial intersection
       * between the two segments (in terms of sweep line ordering), if it exists.
       *
       * A 'non-trivial' intersection is one that will cause one or both of the
       * segments to be split(). As such, 'trivial' vs. 'non-trivial' intersection:
       *
       *   * endpoint of segA with endpoint of segB --> trivial
       *   * endpoint of segA with point along segB --> non-trivial
       *   * endpoint of segB with point along segA --> non-trivial
       *   * point along segA with point along segB --> non-trivial
       *
       * If no non-trivial intersection exists, return null
       * Else, return null.
       */
      getIntersection(other) {
        const tBbox = this.bbox();
        const oBbox = other.bbox();
        const bboxOverlap = getBboxOverlap(tBbox, oBbox);
        if (bboxOverlap === null) return null;
        const tlp = this.leftSE.point;
        const trp = this.rightSE.point;
        const olp = other.leftSE.point;
        const orp = other.rightSE.point;
        const touchesOtherLSE = isInBbox(tBbox, olp) && this.comparePoint(olp) === 0;
        const touchesThisLSE = isInBbox(oBbox, tlp) && other.comparePoint(tlp) === 0;
        const touchesOtherRSE = isInBbox(tBbox, orp) && this.comparePoint(orp) === 0;
        const touchesThisRSE = isInBbox(oBbox, trp) && other.comparePoint(trp) === 0;
        if (touchesThisLSE && touchesOtherLSE) {
          if (touchesThisRSE && !touchesOtherRSE) return trp;
          if (!touchesThisRSE && touchesOtherRSE) return orp;
          return null;
        }
        if (touchesThisLSE) {
          if (touchesOtherRSE) {
            if (tlp.x === orp.x && tlp.y === orp.y) return null;
          }
          return tlp;
        }
        if (touchesOtherLSE) {
          if (touchesThisRSE) {
            if (trp.x === olp.x && trp.y === olp.y) return null;
          }
          return olp;
        }
        if (touchesThisRSE && touchesOtherRSE) return null;
        if (touchesThisRSE) return trp;
        if (touchesOtherRSE) return orp;
        const pt = intersection$1(tlp, this.vector(), olp, other.vector());
        if (pt === null) return null;
        if (!isInBbox(bboxOverlap, pt)) return null;
        return rounder.round(pt.x, pt.y);
      }
      /**
       * Split the given segment into multiple segments on the given points.
       *  * Each existing segment will retain its leftSE and a new rightSE will be
       *    generated for it.
       *  * A new segment will be generated which will adopt the original segment's
       *    rightSE, and a new leftSE will be generated for it.
       *  * If there are more than two points given to split on, new segments
       *    in the middle will be generated with new leftSE and rightSE's.
       *  * An array of the newly generated SweepEvents will be returned.
       *
       * Warning: input array of points is modified
       */
      split(point) {
        const newEvents = [];
        const alreadyLinked = point.events !== void 0;
        const newLeftSE = new SweepEvent(point, true);
        const newRightSE = new SweepEvent(point, false);
        const oldRightSE = this.rightSE;
        this.replaceRightSE(newRightSE);
        newEvents.push(newRightSE);
        newEvents.push(newLeftSE);
        const newSeg = new _Segment(newLeftSE, oldRightSE, this.rings.slice(), this.windings.slice());
        if (SweepEvent.comparePoints(newSeg.leftSE.point, newSeg.rightSE.point) > 0) {
          newSeg.swapEvents();
        }
        if (SweepEvent.comparePoints(this.leftSE.point, this.rightSE.point) > 0) {
          this.swapEvents();
        }
        if (alreadyLinked) {
          newLeftSE.checkForConsuming();
          newRightSE.checkForConsuming();
        }
        return newEvents;
      }
      /* Swap which event is left and right */
      swapEvents() {
        const tmpEvt = this.rightSE;
        this.rightSE = this.leftSE;
        this.leftSE = tmpEvt;
        this.leftSE.isLeft = true;
        this.rightSE.isLeft = false;
        for (let i = 0, iMax = this.windings.length; i < iMax; i++) {
          this.windings[i] *= -1;
        }
      }
      /* Consume another segment. We take their rings under our wing
       * and mark them as consumed. Use for perfectly overlapping segments */
      consume(other) {
        let consumer = this;
        let consumee = other;
        while (consumer.consumedBy) consumer = consumer.consumedBy;
        while (consumee.consumedBy) consumee = consumee.consumedBy;
        const cmp2 = _Segment.compare(consumer, consumee);
        if (cmp2 === 0) return;
        if (cmp2 > 0) {
          const tmp = consumer;
          consumer = consumee;
          consumee = tmp;
        }
        if (consumer.prev === consumee) {
          const tmp = consumer;
          consumer = consumee;
          consumee = tmp;
        }
        for (let i = 0, iMax = consumee.rings.length; i < iMax; i++) {
          const ring = consumee.rings[i];
          const winding = consumee.windings[i];
          const index2 = consumer.rings.indexOf(ring);
          if (index2 === -1) {
            consumer.rings.push(ring);
            consumer.windings.push(winding);
          } else consumer.windings[index2] += winding;
        }
        consumee.rings = null;
        consumee.windings = null;
        consumee.consumedBy = consumer;
        consumee.leftSE.consumedBy = consumer.leftSE;
        consumee.rightSE.consumedBy = consumer.rightSE;
      }
      /* The first segment previous segment chain that is in the result */
      prevInResult() {
        if (this._prevInResult !== void 0) return this._prevInResult;
        if (!this.prev) this._prevInResult = null;
        else if (this.prev.isInResult()) this._prevInResult = this.prev;
        else this._prevInResult = this.prev.prevInResult();
        return this._prevInResult;
      }
      beforeState() {
        if (this._beforeState !== void 0) return this._beforeState;
        if (!this.prev) this._beforeState = {
          rings: [],
          windings: [],
          multiPolys: []
        };
        else {
          const seg = this.prev.consumedBy || this.prev;
          this._beforeState = seg.afterState();
        }
        return this._beforeState;
      }
      afterState() {
        if (this._afterState !== void 0) return this._afterState;
        const beforeState = this.beforeState();
        this._afterState = {
          rings: beforeState.rings.slice(0),
          windings: beforeState.windings.slice(0),
          multiPolys: []
        };
        const ringsAfter = this._afterState.rings;
        const windingsAfter = this._afterState.windings;
        const mpsAfter = this._afterState.multiPolys;
        for (let i = 0, iMax = this.rings.length; i < iMax; i++) {
          const ring = this.rings[i];
          const winding = this.windings[i];
          const index2 = ringsAfter.indexOf(ring);
          if (index2 === -1) {
            ringsAfter.push(ring);
            windingsAfter.push(winding);
          } else windingsAfter[index2] += winding;
        }
        const polysAfter = [];
        const polysExclude = [];
        for (let i = 0, iMax = ringsAfter.length; i < iMax; i++) {
          if (windingsAfter[i] === 0) continue;
          const ring = ringsAfter[i];
          const poly = ring.poly;
          if (polysExclude.indexOf(poly) !== -1) continue;
          if (ring.isExterior) polysAfter.push(poly);
          else {
            if (polysExclude.indexOf(poly) === -1) polysExclude.push(poly);
            const index2 = polysAfter.indexOf(ring.poly);
            if (index2 !== -1) polysAfter.splice(index2, 1);
          }
        }
        for (let i = 0, iMax = polysAfter.length; i < iMax; i++) {
          const mp = polysAfter[i].multiPoly;
          if (mpsAfter.indexOf(mp) === -1) mpsAfter.push(mp);
        }
        return this._afterState;
      }
      /* Is this segment part of the final result? */
      isInResult() {
        if (this.consumedBy) return false;
        if (this._isInResult !== void 0) return this._isInResult;
        const mpsBefore = this.beforeState().multiPolys;
        const mpsAfter = this.afterState().multiPolys;
        switch (operation.type) {
          case "union": {
            const noBefores = mpsBefore.length === 0;
            const noAfters = mpsAfter.length === 0;
            this._isInResult = noBefores !== noAfters;
            break;
          }
          case "intersection": {
            let least;
            let most;
            if (mpsBefore.length < mpsAfter.length) {
              least = mpsBefore.length;
              most = mpsAfter.length;
            } else {
              least = mpsAfter.length;
              most = mpsBefore.length;
            }
            this._isInResult = most === operation.numMultiPolys && least < most;
            break;
          }
          case "xor": {
            const diff = Math.abs(mpsBefore.length - mpsAfter.length);
            this._isInResult = diff % 2 === 1;
            break;
          }
          case "difference": {
            const isJustSubject = (mps) => mps.length === 1 && mps[0].isSubject;
            this._isInResult = isJustSubject(mpsBefore) !== isJustSubject(mpsAfter);
            break;
          }
          default:
            throw new Error(`Unrecognized operation type found ${operation.type}`);
        }
        return this._isInResult;
      }
    };
    var RingIn = class {
      constructor(geomRing, poly, isExterior) {
        if (!Array.isArray(geomRing) || geomRing.length === 0) {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        this.poly = poly;
        this.isExterior = isExterior;
        this.segments = [];
        if (typeof geomRing[0][0] !== "number" || typeof geomRing[0][1] !== "number") {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        const firstPoint = rounder.round(geomRing[0][0], geomRing[0][1]);
        this.bbox = {
          ll: {
            x: firstPoint.x,
            y: firstPoint.y
          },
          ur: {
            x: firstPoint.x,
            y: firstPoint.y
          }
        };
        let prevPoint = firstPoint;
        for (let i = 1, iMax = geomRing.length; i < iMax; i++) {
          if (typeof geomRing[i][0] !== "number" || typeof geomRing[i][1] !== "number") {
            throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
          }
          let point = rounder.round(geomRing[i][0], geomRing[i][1]);
          if (point.x === prevPoint.x && point.y === prevPoint.y) continue;
          this.segments.push(Segment.fromRing(prevPoint, point, this));
          if (point.x < this.bbox.ll.x) this.bbox.ll.x = point.x;
          if (point.y < this.bbox.ll.y) this.bbox.ll.y = point.y;
          if (point.x > this.bbox.ur.x) this.bbox.ur.x = point.x;
          if (point.y > this.bbox.ur.y) this.bbox.ur.y = point.y;
          prevPoint = point;
        }
        if (firstPoint.x !== prevPoint.x || firstPoint.y !== prevPoint.y) {
          this.segments.push(Segment.fromRing(prevPoint, firstPoint, this));
        }
      }
      getSweepEvents() {
        const sweepEvents = [];
        for (let i = 0, iMax = this.segments.length; i < iMax; i++) {
          const segment = this.segments[i];
          sweepEvents.push(segment.leftSE);
          sweepEvents.push(segment.rightSE);
        }
        return sweepEvents;
      }
    };
    var PolyIn = class {
      constructor(geomPoly, multiPoly) {
        if (!Array.isArray(geomPoly)) {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        this.exteriorRing = new RingIn(geomPoly[0], this, true);
        this.bbox = {
          ll: {
            x: this.exteriorRing.bbox.ll.x,
            y: this.exteriorRing.bbox.ll.y
          },
          ur: {
            x: this.exteriorRing.bbox.ur.x,
            y: this.exteriorRing.bbox.ur.y
          }
        };
        this.interiorRings = [];
        for (let i = 1, iMax = geomPoly.length; i < iMax; i++) {
          const ring = new RingIn(geomPoly[i], this, false);
          if (ring.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = ring.bbox.ll.x;
          if (ring.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = ring.bbox.ll.y;
          if (ring.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = ring.bbox.ur.x;
          if (ring.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = ring.bbox.ur.y;
          this.interiorRings.push(ring);
        }
        this.multiPoly = multiPoly;
      }
      getSweepEvents() {
        const sweepEvents = this.exteriorRing.getSweepEvents();
        for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
          const ringSweepEvents = this.interiorRings[i].getSweepEvents();
          for (let j = 0, jMax = ringSweepEvents.length; j < jMax; j++) {
            sweepEvents.push(ringSweepEvents[j]);
          }
        }
        return sweepEvents;
      }
    };
    var MultiPolyIn = class {
      constructor(geom, isSubject) {
        if (!Array.isArray(geom)) {
          throw new Error("Input geometry is not a valid Polygon or MultiPolygon");
        }
        try {
          if (typeof geom[0][0][0] === "number") geom = [geom];
        } catch (ex) {
        }
        this.polys = [];
        this.bbox = {
          ll: {
            x: Number.POSITIVE_INFINITY,
            y: Number.POSITIVE_INFINITY
          },
          ur: {
            x: Number.NEGATIVE_INFINITY,
            y: Number.NEGATIVE_INFINITY
          }
        };
        for (let i = 0, iMax = geom.length; i < iMax; i++) {
          const poly = new PolyIn(geom[i], this);
          if (poly.bbox.ll.x < this.bbox.ll.x) this.bbox.ll.x = poly.bbox.ll.x;
          if (poly.bbox.ll.y < this.bbox.ll.y) this.bbox.ll.y = poly.bbox.ll.y;
          if (poly.bbox.ur.x > this.bbox.ur.x) this.bbox.ur.x = poly.bbox.ur.x;
          if (poly.bbox.ur.y > this.bbox.ur.y) this.bbox.ur.y = poly.bbox.ur.y;
          this.polys.push(poly);
        }
        this.isSubject = isSubject;
      }
      getSweepEvents() {
        const sweepEvents = [];
        for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
          const polySweepEvents = this.polys[i].getSweepEvents();
          for (let j = 0, jMax = polySweepEvents.length; j < jMax; j++) {
            sweepEvents.push(polySweepEvents[j]);
          }
        }
        return sweepEvents;
      }
    };
    var RingOut = class _RingOut {
      /* Given the segments from the sweep line pass, compute & return a series
       * of closed rings from all the segments marked to be part of the result */
      static factory(allSegments) {
        const ringsOut = [];
        for (let i = 0, iMax = allSegments.length; i < iMax; i++) {
          const segment = allSegments[i];
          if (!segment.isInResult() || segment.ringOut) continue;
          let prevEvent = null;
          let event = segment.leftSE;
          let nextEvent = segment.rightSE;
          const events = [event];
          const startingPoint = event.point;
          const intersectionLEs = [];
          while (true) {
            prevEvent = event;
            event = nextEvent;
            events.push(event);
            if (event.point === startingPoint) break;
            while (true) {
              const availableLEs = event.getAvailableLinkedEvents();
              if (availableLEs.length === 0) {
                const firstPt = events[0].point;
                const lastPt = events[events.length - 1].point;
                throw new Error(`Unable to complete output ring starting at [${firstPt.x}, ${firstPt.y}]. Last matching segment found ends at [${lastPt.x}, ${lastPt.y}].`);
              }
              if (availableLEs.length === 1) {
                nextEvent = availableLEs[0].otherSE;
                break;
              }
              let indexLE = null;
              for (let j = 0, jMax = intersectionLEs.length; j < jMax; j++) {
                if (intersectionLEs[j].point === event.point) {
                  indexLE = j;
                  break;
                }
              }
              if (indexLE !== null) {
                const intersectionLE = intersectionLEs.splice(indexLE)[0];
                const ringEvents = events.splice(intersectionLE.index);
                ringEvents.unshift(ringEvents[0].otherSE);
                ringsOut.push(new _RingOut(ringEvents.reverse()));
                continue;
              }
              intersectionLEs.push({
                index: events.length,
                point: event.point
              });
              const comparator = event.getLeftmostComparator(prevEvent);
              nextEvent = availableLEs.sort(comparator)[0].otherSE;
              break;
            }
          }
          ringsOut.push(new _RingOut(events));
        }
        return ringsOut;
      }
      constructor(events) {
        this.events = events;
        for (let i = 0, iMax = events.length; i < iMax; i++) {
          events[i].segment.ringOut = this;
        }
        this.poly = null;
      }
      getGeom() {
        let prevPt = this.events[0].point;
        const points = [prevPt];
        for (let i = 1, iMax = this.events.length - 1; i < iMax; i++) {
          const pt2 = this.events[i].point;
          const nextPt2 = this.events[i + 1].point;
          if (compareVectorAngles(pt2, prevPt, nextPt2) === 0) continue;
          points.push(pt2);
          prevPt = pt2;
        }
        if (points.length === 1) return null;
        const pt = points[0];
        const nextPt = points[1];
        if (compareVectorAngles(pt, prevPt, nextPt) === 0) points.shift();
        points.push(points[0]);
        const step = this.isExteriorRing() ? 1 : -1;
        const iStart = this.isExteriorRing() ? 0 : points.length - 1;
        const iEnd = this.isExteriorRing() ? points.length : -1;
        const orderedPoints = [];
        for (let i = iStart; i != iEnd; i += step) orderedPoints.push([points[i].x, points[i].y]);
        return orderedPoints;
      }
      isExteriorRing() {
        if (this._isExteriorRing === void 0) {
          const enclosing = this.enclosingRing();
          this._isExteriorRing = enclosing ? !enclosing.isExteriorRing() : true;
        }
        return this._isExteriorRing;
      }
      enclosingRing() {
        if (this._enclosingRing === void 0) {
          this._enclosingRing = this._calcEnclosingRing();
        }
        return this._enclosingRing;
      }
      /* Returns the ring that encloses this one, if any */
      _calcEnclosingRing() {
        let leftMostEvt = this.events[0];
        for (let i = 1, iMax = this.events.length; i < iMax; i++) {
          const evt = this.events[i];
          if (SweepEvent.compare(leftMostEvt, evt) > 0) leftMostEvt = evt;
        }
        let prevSeg = leftMostEvt.segment.prevInResult();
        let prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
        while (true) {
          if (!prevSeg) return null;
          if (!prevPrevSeg) return prevSeg.ringOut;
          if (prevPrevSeg.ringOut !== prevSeg.ringOut) {
            if (prevPrevSeg.ringOut.enclosingRing() !== prevSeg.ringOut) {
              return prevSeg.ringOut;
            } else return prevSeg.ringOut.enclosingRing();
          }
          prevSeg = prevPrevSeg.prevInResult();
          prevPrevSeg = prevSeg ? prevSeg.prevInResult() : null;
        }
      }
    };
    var PolyOut = class {
      constructor(exteriorRing) {
        this.exteriorRing = exteriorRing;
        exteriorRing.poly = this;
        this.interiorRings = [];
      }
      addInterior(ring) {
        this.interiorRings.push(ring);
        ring.poly = this;
      }
      getGeom() {
        const geom = [this.exteriorRing.getGeom()];
        if (geom[0] === null) return null;
        for (let i = 0, iMax = this.interiorRings.length; i < iMax; i++) {
          const ringGeom = this.interiorRings[i].getGeom();
          if (ringGeom === null) continue;
          geom.push(ringGeom);
        }
        return geom;
      }
    };
    var MultiPolyOut = class {
      constructor(rings) {
        this.rings = rings;
        this.polys = this._composePolys(rings);
      }
      getGeom() {
        const geom = [];
        for (let i = 0, iMax = this.polys.length; i < iMax; i++) {
          const polyGeom = this.polys[i].getGeom();
          if (polyGeom === null) continue;
          geom.push(polyGeom);
        }
        return geom;
      }
      _composePolys(rings) {
        const polys = [];
        for (let i = 0, iMax = rings.length; i < iMax; i++) {
          const ring = rings[i];
          if (ring.poly) continue;
          if (ring.isExteriorRing()) polys.push(new PolyOut(ring));
          else {
            const enclosingRing = ring.enclosingRing();
            if (!enclosingRing.poly) polys.push(new PolyOut(enclosingRing));
            enclosingRing.poly.addInterior(ring);
          }
        }
        return polys;
      }
    };
    var SweepLine = class {
      constructor(queue) {
        let comparator = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : Segment.compare;
        this.queue = queue;
        this.tree = new SplayTree__default["default"](comparator);
        this.segments = [];
      }
      process(event) {
        const segment = event.segment;
        const newEvents = [];
        if (event.consumedBy) {
          if (event.isLeft) this.queue.remove(event.otherSE);
          else this.tree.remove(segment);
          return newEvents;
        }
        const node = event.isLeft ? this.tree.add(segment) : this.tree.find(segment);
        if (!node) throw new Error(`Unable to find segment #${segment.id} [${segment.leftSE.point.x}, ${segment.leftSE.point.y}] -> [${segment.rightSE.point.x}, ${segment.rightSE.point.y}] in SweepLine tree.`);
        let prevNode = node;
        let nextNode = node;
        let prevSeg = void 0;
        let nextSeg = void 0;
        while (prevSeg === void 0) {
          prevNode = this.tree.prev(prevNode);
          if (prevNode === null) prevSeg = null;
          else if (prevNode.key.consumedBy === void 0) prevSeg = prevNode.key;
        }
        while (nextSeg === void 0) {
          nextNode = this.tree.next(nextNode);
          if (nextNode === null) nextSeg = null;
          else if (nextNode.key.consumedBy === void 0) nextSeg = nextNode.key;
        }
        if (event.isLeft) {
          let prevMySplitter = null;
          if (prevSeg) {
            const prevInter = prevSeg.getIntersection(segment);
            if (prevInter !== null) {
              if (!segment.isAnEndpoint(prevInter)) prevMySplitter = prevInter;
              if (!prevSeg.isAnEndpoint(prevInter)) {
                const newEventsFromSplit = this._splitSafely(prevSeg, prevInter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
            }
          }
          let nextMySplitter = null;
          if (nextSeg) {
            const nextInter = nextSeg.getIntersection(segment);
            if (nextInter !== null) {
              if (!segment.isAnEndpoint(nextInter)) nextMySplitter = nextInter;
              if (!nextSeg.isAnEndpoint(nextInter)) {
                const newEventsFromSplit = this._splitSafely(nextSeg, nextInter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
            }
          }
          if (prevMySplitter !== null || nextMySplitter !== null) {
            let mySplitter = null;
            if (prevMySplitter === null) mySplitter = nextMySplitter;
            else if (nextMySplitter === null) mySplitter = prevMySplitter;
            else {
              const cmpSplitters = SweepEvent.comparePoints(prevMySplitter, nextMySplitter);
              mySplitter = cmpSplitters <= 0 ? prevMySplitter : nextMySplitter;
            }
            this.queue.remove(segment.rightSE);
            newEvents.push(segment.rightSE);
            const newEventsFromSplit = segment.split(mySplitter);
            for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
              newEvents.push(newEventsFromSplit[i]);
            }
          }
          if (newEvents.length > 0) {
            this.tree.remove(segment);
            newEvents.push(event);
          } else {
            this.segments.push(segment);
            segment.prev = prevSeg;
          }
        } else {
          if (prevSeg && nextSeg) {
            const inter = prevSeg.getIntersection(nextSeg);
            if (inter !== null) {
              if (!prevSeg.isAnEndpoint(inter)) {
                const newEventsFromSplit = this._splitSafely(prevSeg, inter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
              if (!nextSeg.isAnEndpoint(inter)) {
                const newEventsFromSplit = this._splitSafely(nextSeg, inter);
                for (let i = 0, iMax = newEventsFromSplit.length; i < iMax; i++) {
                  newEvents.push(newEventsFromSplit[i]);
                }
              }
            }
          }
          this.tree.remove(segment);
        }
        return newEvents;
      }
      /* Safely split a segment that is currently in the datastructures
       * IE - a segment other than the one that is currently being processed. */
      _splitSafely(seg, pt) {
        this.tree.remove(seg);
        const rightSE = seg.rightSE;
        this.queue.remove(rightSE);
        const newEvents = seg.split(pt);
        newEvents.push(rightSE);
        if (seg.consumedBy === void 0) this.tree.add(seg);
        return newEvents;
      }
    };
    var POLYGON_CLIPPING_MAX_QUEUE_SIZE = typeof process !== "undefined" && process.env.POLYGON_CLIPPING_MAX_QUEUE_SIZE || 1e6;
    var POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS = typeof process !== "undefined" && process.env.POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS || 1e6;
    var Operation = class {
      run(type, geom, moreGeoms) {
        operation.type = type;
        rounder.reset();
        const multipolys = [new MultiPolyIn(geom, true)];
        for (let i = 0, iMax = moreGeoms.length; i < iMax; i++) {
          multipolys.push(new MultiPolyIn(moreGeoms[i], false));
        }
        operation.numMultiPolys = multipolys.length;
        if (operation.type === "difference") {
          const subject = multipolys[0];
          let i = 1;
          while (i < multipolys.length) {
            if (getBboxOverlap(multipolys[i].bbox, subject.bbox) !== null) i++;
            else multipolys.splice(i, 1);
          }
        }
        if (operation.type === "intersection") {
          for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
            const mpA = multipolys[i];
            for (let j = i + 1, jMax = multipolys.length; j < jMax; j++) {
              if (getBboxOverlap(mpA.bbox, multipolys[j].bbox) === null) return [];
            }
          }
        }
        const queue = new SplayTree__default["default"](SweepEvent.compare);
        for (let i = 0, iMax = multipolys.length; i < iMax; i++) {
          const sweepEvents = multipolys[i].getSweepEvents();
          for (let j = 0, jMax = sweepEvents.length; j < jMax; j++) {
            queue.insert(sweepEvents[j]);
            if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
              throw new Error("Infinite loop when putting segment endpoints in a priority queue (queue size too big).");
            }
          }
        }
        const sweepLine = new SweepLine(queue);
        let prevQueueSize = queue.size;
        let node = queue.pop();
        while (node) {
          const evt = node.key;
          if (queue.size === prevQueueSize) {
            const seg = evt.segment;
            throw new Error(`Unable to pop() ${evt.isLeft ? "left" : "right"} SweepEvent [${evt.point.x}, ${evt.point.y}] from segment #${seg.id} [${seg.leftSE.point.x}, ${seg.leftSE.point.y}] -> [${seg.rightSE.point.x}, ${seg.rightSE.point.y}] from queue.`);
          }
          if (queue.size > POLYGON_CLIPPING_MAX_QUEUE_SIZE) {
            throw new Error("Infinite loop when passing sweep line over endpoints (queue size too big).");
          }
          if (sweepLine.segments.length > POLYGON_CLIPPING_MAX_SWEEPLINE_SEGMENTS) {
            throw new Error("Infinite loop when passing sweep line over endpoints (too many sweep line segments).");
          }
          const newEvents = sweepLine.process(evt);
          for (let i = 0, iMax = newEvents.length; i < iMax; i++) {
            const evt2 = newEvents[i];
            if (evt2.consumedBy === void 0) queue.insert(evt2);
          }
          prevQueueSize = queue.size;
          node = queue.pop();
        }
        rounder.reset();
        const ringsOut = RingOut.factory(sweepLine.segments);
        const result = new MultiPolyOut(ringsOut);
        return result.getGeom();
      }
    };
    var operation = new Operation();
    var union = function(geom) {
      for (var _len = arguments.length, moreGeoms = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        moreGeoms[_key - 1] = arguments[_key];
      }
      return operation.run("union", geom, moreGeoms);
    };
    var intersection = function(geom) {
      for (var _len2 = arguments.length, moreGeoms = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
        moreGeoms[_key2 - 1] = arguments[_key2];
      }
      return operation.run("intersection", geom, moreGeoms);
    };
    var xor = function(geom) {
      for (var _len3 = arguments.length, moreGeoms = new Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
        moreGeoms[_key3 - 1] = arguments[_key3];
      }
      return operation.run("xor", geom, moreGeoms);
    };
    var difference = function(subjectGeom) {
      for (var _len4 = arguments.length, clippingGeoms = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
        clippingGeoms[_key4 - 1] = arguments[_key4];
      }
      return operation.run("difference", subjectGeom, clippingGeoms);
    };
    var index = {
      union,
      intersection,
      xor,
      difference
    };
    module.exports = index;
  }
});

// ../engine/src/matrix/matrixCore.ts
var round6 = (x) => {
  if (!Number.isFinite(x)) return x;
  const a = Math.abs(x);
  if (a < 1e-12) return 0;
  const f = Math.pow(10, Math.ceil(-Math.log10(a)) + 12);
  return Math.round(x * f) / f;
};
var parseMatrix = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    const rows2d = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray(v.values) ? v.values : null;
    if (!rows2d || !Array.isArray(rows2d[0])) return [];
    return rows2d.map((row) => Array.isArray(row) ? row.map((x) => Number.isFinite(Number(x)) ? Number(x) : 0) : []);
  } catch {
    return [];
  }
};
var parseMatrixOrScalar = (raw) => {
  if (typeof raw === "number" && Number.isFinite(raw)) return [[raw]];
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t && t[0] !== "[" && t[0] !== "{") {
      const n = Number(t);
      if (Number.isFinite(n)) return [[n]];
    }
  }
  return parseMatrix(raw);
};
var isRectMatrix = (M2) => M2.length > 0 && M2[0].length > 0 && M2.every((r) => r.length === M2[0].length);
var transposeMatrix = (M2) => {
  const rows = M2.length, cols = M2[0]?.length ?? 0;
  const T = [];
  for (let j = 0; j < cols; j++) {
    const row = [];
    for (let i = 0; i < rows; i++) row.push(M2[i][j] ?? 0);
    T.push(row);
  }
  return T;
};
var invertMatrix = (M2) => {
  const n = M2.length;
  if (n === 0 || M2.some((r) => r.length !== n)) return null;
  const A = M2.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let k = 0; k < 2 * n; k++) A[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      for (let k = 0; k < 2 * n; k++) A[r][k] -= f * A[col][k];
    }
  }
  return A.map((r) => r.slice(n).map(round6));
};
var broadcastShape = (A, B) => {
  if (!isRectMatrix(A) || !isRectMatrix(B)) return null;
  const ar = A.length, ac = A[0].length, br = B.length, bc = B[0].length;
  if (ar !== br && ar !== 1 && br !== 1) return null;
  if (ac !== bc && ac !== 1 && bc !== 1) return null;
  return { rows: Math.max(ar, br), cols: Math.max(ac, bc) };
};
var bcAt = (M2, i, j) => M2[M2.length === 1 ? 0 : i]?.[M2[0].length === 1 ? 0 : j] ?? 0;
var elementwiseMatrix = (A, B, f) => {
  const shape = broadcastShape(A, B);
  if (!shape) return null;
  const out = [];
  for (let i = 0; i < shape.rows; i++) {
    const row = [];
    for (let j = 0; j < shape.cols; j++) row.push(round6(f(bcAt(A, i, j), bcAt(B, i, j))));
    out.push(row);
  }
  return out;
};
var ELEMENTWISE = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => Math.abs(b) < 1e-12 ? 0 : a / b,
  "%": (a, b) => Math.abs(b) < 1e-12 ? 0 : a % b,
  "^": (a, b) => Math.pow(a, b)
};
var multiplyMatrix = (A, B) => {
  if (!isRectMatrix(A) || !isRectMatrix(B)) return null;
  const n = A.length, k = A[0].length, m = B[0].length;
  if (k !== B.length) return null;
  const P = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
      row.push(round6(s));
    }
    P.push(row);
  }
  return P;
};
var solveMatrix = (K, F) => {
  const n = K.length;
  if (n === 0 || K.some((r) => r.length !== n) || !isRectMatrix(F) || F.length !== n) return null;
  const m = F[0].length;
  const A = K.map((r, i) => [...r, ...F[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    const d = A[col][col];
    for (let k = col; k < n + m; k++) A[col][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let k = col; k < n + m; k++) A[r][k] -= f * A[col][k];
    }
  }
  return A.map((r) => r.slice(n).map(round6));
};
var shiftMatrix = (M2, by, axis = "rows") => {
  const n = M2.length;
  if (n === 0) return [];
  const b = Math.round(by) || 0;
  if (axis === "cols") {
    const c = M2[0]?.length ?? 0;
    if (c === 0) return M2.map((r) => r.slice());
    return M2.map((row) => row.map((_, j) => row[((j - b) % c + c) % c]));
  }
  return M2.map((_, i) => M2[((i - b) % n + n) % n].slice());
};
var sortMatrix = (M2, axis = "rows") => {
  if (!isRectMatrix(M2)) return [];
  const asc = (a, b) => a - b;
  if (axis === "cols") {
    const cols = M2[0].map((_, j) => M2.map((r) => r[j] ?? 0).sort(asc));
    return M2.map((_, i) => cols.map((c) => c[i]));
  }
  return M2.map((r) => r.slice().sort(asc));
};
var sortByMatrix = (M2, key) => {
  if (!isRectMatrix(M2)) return [];
  const k = (i) => key[key.length === 1 ? 0 : i]?.[0] ?? 0;
  return M2.map((row, i) => ({ row, i })).sort((a, b) => k(a.i) - k(b.i) || a.i - b.i).map(({ row }) => row.slice());
};
var compressMatrix = (M2, mask) => {
  if (!isRectMatrix(M2)) return [];
  const m = (i) => mask[mask.length === 1 ? 0 : i]?.[0] ?? 0;
  return M2.filter((_, i) => Math.abs(m(i)) > 1e-12).map((r) => r.slice());
};
var selectMatrix = (mask, A, B) => {
  const s1 = broadcastShape(mask, A);
  if (!s1) return null;
  const s2 = broadcastShape(A, B);
  if (!s2) return null;
  const rows = Math.max(s1.rows, s2.rows), cols = Math.max(s1.cols, s2.cols);
  const out = [];
  for (let i = 0; i < rows; i++) {
    const row = [];
    for (let j = 0; j < cols; j++) row.push(round6(bcAt(mask, i, j) !== 0 ? bcAt(A, i, j) : bcAt(B, i, j)));
    out.push(row);
  }
  return out;
};
var vectorOpMatrix = (V, op) => {
  if (!isRectMatrix(V)) return [];
  return op === "length" ? V.map((r) => [round6(Math.hypot(...r))]) : op === "angle" ? V.map((r) => [round6(Math.atan2(r[1] ?? 0, r[0] ?? 0) * 180 / Math.PI)]) : op === "perp" ? V.map((r) => [round6(-(r[1] ?? 0)), round6(r[0] ?? 0)]) : op === "perp-cw" ? V.map((r) => [round6(r[1] ?? 0), round6(-(r[0] ?? 0))]) : op === "negate" ? V.map((r) => r.map((x) => round6(-x))) : V.map((r) => {
    const L = Math.hypot(...r);
    return L < 1e-12 ? r.map(() => 0) : r.map((x) => round6(x / L));
  });
};
var vectorProductMatrix = (A, B, op) => {
  const shape = broadcastShape(A, B);
  if (!shape) return [];
  const { rows, cols } = shape;
  const dotAt = (i) => {
    let s = 0;
    for (let j = 0; j < cols; j++) s += bcAt(A, i, j) * bcAt(B, i, j);
    return s;
  };
  const cross2At = (i) => bcAt(A, i, 0) * bcAt(B, i, 1) - bcAt(A, i, 1) * bcAt(B, i, 0);
  const cross3At = (i) => [
    bcAt(A, i, 1) * bcAt(B, i, 2) - bcAt(A, i, 2) * bcAt(B, i, 1),
    bcAt(A, i, 2) * bcAt(B, i, 0) - bcAt(A, i, 0) * bcAt(B, i, 2),
    bcAt(A, i, 0) * bcAt(B, i, 1) - bcAt(A, i, 1) * bcAt(B, i, 0)
  ];
  const R = [];
  for (let i = 0; i < rows; i++) {
    if (op === "cross") R.push(cols >= 3 ? cross3At(i).map(round6) : [round6(cross2At(i))]);
    else if (op === "angle") {
      const c = cols >= 3 ? Math.hypot(...cross3At(i)) : cross2At(i);
      R.push([round6(Math.atan2(c, dotAt(i)) * 180 / Math.PI)]);
    } else R.push([round6(dotAt(i))]);
  }
  return R;
};
var reduceMatrix = (M2, op, axis) => {
  if (!isRectMatrix(M2)) return [];
  const fold = (xs) => op === "min" ? xs.reduce((a, b) => b < a ? b : a, Infinity) : op === "max" ? xs.reduce((a, b) => b > a ? b : a, -Infinity) : op === "mean" ? xs.reduce((a, b) => a + b, 0) / (xs.length || 1) : op === "product" ? xs.reduce((a, b) => a * b, 1) : xs.reduce((a, b) => a + b, 0);
  return axis === "rows" ? M2.map((r) => [round6(fold(r))]) : axis === "cols" ? [M2[0].map((_, j) => round6(fold(M2.map((r) => r[j] ?? 0))))] : [[round6(fold(M2.reduce((acc, r) => acc.concat(r), [])))]];
};
var eyeMatrix = (n) => {
  const k = Math.max(0, Math.round(n) || 0);
  return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_2, j) => i === j ? 1 : 0));
};
var fillMatrix = (rows, cols, fill) => {
  const r = Math.max(0, Math.round(rows) || 0), c = Math.max(0, Math.round(cols) || 0);
  return Array.from({ length: r }, () => new Array(c).fill(fill));
};
var arangeMatrix = (a, b) => {
  const lo = b === void 0 ? 0 : Math.round(a), hi = b === void 0 ? Math.round(a) : Math.round(b);
  const out = [];
  for (let i = lo; i < hi; i++) out.push([i]);
  return out;
};
var diagMatrix = (M2) => {
  if (!isRectMatrix(M2)) return [];
  const r = M2.length, c = M2[0].length;
  if (r === 1 || c === 1) {
    const v = r === 1 ? M2[0] : M2.map((row) => row[0]);
    return v.map((x, i) => v.map((_, j) => i === j ? x : 0));
  }
  return M2.map((row, i) => [row[i] ?? 0]);
};
var kronMatrix = (A, B) => {
  if (!isRectMatrix(A) || !isRectMatrix(B)) return null;
  const ra = A.length, ca = A[0].length, rb = B.length, cb = B[0].length;
  const out = [];
  for (let i = 0; i < ra * rb; i++) {
    const row = [];
    for (let j = 0; j < ca * cb; j++) row.push(round6(A[Math.floor(i / rb)][Math.floor(j / cb)] * B[i % rb][j % cb]));
    out.push(row);
  }
  return out;
};
var subMatrix = (M2, r0, c0, nr, nc) => {
  if (!isRectMatrix(M2)) return [];
  const a = Math.max(0, Math.round(r0) || 0), b = Math.max(0, Math.round(c0) || 0);
  return M2.slice(a, a + Math.max(0, Math.round(nr) || 0)).map((row) => row.slice(b, b + Math.max(0, Math.round(nc) || 0)));
};
var hcatMatrix = (A, B) => {
  if (!isRectMatrix(A)) return isRectMatrix(B) ? B.map((r) => r.slice()) : [];
  if (!isRectMatrix(B)) return A.map((r) => r.slice());
  if (A.length !== B.length) return null;
  return A.map((row, i) => [...row, ...B[i]]);
};
var vcatMatrix = (A, B) => {
  if (!isRectMatrix(A)) return isRectMatrix(B) ? B.map((r) => r.slice()) : [];
  if (!isRectMatrix(B)) return A.map((r) => r.slice());
  if (A[0].length !== B[0].length) return null;
  return [...A.map((r) => r.slice()), ...B.map((r) => r.slice())];
};
var reshapeMatrix = (M2, rows, cols) => {
  const r = Math.max(0, Math.round(rows) || 0), c = Math.max(0, Math.round(cols) || 0);
  if (r === 0 || c === 0) return [];
  const flat = [];
  for (const row of M2) for (const x of row) flat.push(x);
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_2, j) => flat[i * c + j] ?? 0));
};

// ../engine/src/matrix/polyBool.ts
var PolygonClippingNS = __toESM(require_polygon_clipping_cjs(), 1);
var pc = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PolygonClippingNS.default ?? PolygonClippingNS
);
var matrixToRings = (M2) => {
  if (!isRectMatrix(M2) || M2.length < 3) return [];
  const wide = M2[0].length >= 3;
  if (!wide) return [M2.map((r) => [r[0], r[1]])];
  const out = [];
  let cur = [];
  let key = null;
  for (const r of M2) {
    if (key !== null && r[2] !== key) {
      if (cur.length >= 3) out.push(cur);
      cur = [];
    }
    key = r[2];
    cur.push([r[0], r[1]]);
  }
  if (cur.length >= 3) out.push(cur);
  return out;
};
var ringsToMatrix = (rings) => {
  const out = [];
  let g = 0;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (const p of ring) out.push([round6(p[0]), round6(p[1]), g]);
    g++;
  }
  return out;
};
var toPcRing = (ring) => {
  const r = ring.map((p) => [p[0], p[1]]);
  if (r.length) r.push([r[0][0], r[0][1]]);
  return r;
};
var fromPcRing = (ring) => {
  const pts = ring.map(([x, y]) => [x, y]);
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) pts.pop();
  }
  return pts;
};
var ringsToMulti = (rings) => {
  const mps = rings.filter((r) => r.length >= 3).map((r) => [toPcRing(r)]);
  if (!mps.length) return [];
  if (mps.length === 1) return [mps[0]];
  try {
    return pc.xor(mps[0], ...mps.slice(1));
  } catch {
    return mps;
  }
};
var multiToRings = (mp) => {
  const out = [];
  for (const poly of mp) for (const ring of poly) {
    const p = fromPcRing(ring);
    if (p.length >= 3) out.push(p);
  }
  return out;
};
var boolMatrix2d = (A, B, op) => {
  const ra = matrixToRings(A);
  if (!ra.length) return [];
  const ma = ringsToMulti(ra);
  if (!ma.length) return [];
  const mb = ringsToMulti(matrixToRings(B));
  if (!mb.length) return op === "intersect" ? [] : ringsToMatrix(multiToRings(ma));
  try {
    return ringsToMatrix(multiToRings(
      op === "subtract" ? pc.difference(ma, mb) : op === "intersect" ? pc.intersection(ma, mb) : op === "xor" ? pc.xor(ma, mb) : pc.union(ma, mb)
    ));
  } catch {
    return ringsToMatrix(multiToRings(ma));
  }
};
var inPolyMask = (P, R) => {
  if (!isRectMatrix(P)) return [];
  const rings = matrixToRings(R);
  return P.map((p) => {
    const x = p[0], y = p[1];
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
    }
    return [inside ? 1 : 0];
  });
};

// ../engine/src/matrix/axisMesh.ts
var add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var mul3 = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
var norm3 = (v) => Math.hypot(v[0], v[1], v[2]);
var cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var basisFor = (d) => {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  const seed = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const raw = cross3(d, seed);
  const l = norm3(raw);
  const e1 = l > 1e-9 ? mul3(raw, 1 / l) : [1, 0, 0];
  return [e1, cross3(d, e1)];
};
var loftFaces = (sections) => {
  const secs = sections.filter((s) => Array.isArray(s) && s.length >= 3);
  if (secs.length < 2) return [];
  const faces = [[...secs[0]].reverse()];
  for (let i = 0; i + 1 < secs.length; i++) {
    const A = secs[i], B = secs[i + 1];
    const n = Math.min(A.length, B.length);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      faces.push([A[k], A[j], B[j], B[k]]);
    }
  }
  faces.push(secs[secs.length - 1]);
  return faces;
};
var tubeFaces = (a, b, radius, sides = 12, radiusB) => {
  const d = sub3(b, a);
  const L = norm3(d);
  if (L < 1e-6) return [];
  const n = Math.max(3, Math.round(sides));
  const rA = Math.max(1e-5, radius);
  const rB = radiusB === void 0 ? rA : Math.max(1e-5, radiusB);
  const u = mul3(d, 1 / L);
  const [e1, e2] = basisFor(u);
  const ringAt = (o, r) => Array.from({ length: n }, (_, k) => {
    const t = 2 * Math.PI * k / n;
    return add3(o, add3(mul3(e1, r * Math.cos(t)), mul3(e2, r * Math.sin(t))));
  });
  const A = ringAt(a, rA), B = ringAt(b, rB);
  const faces = [[...A].reverse(), B];
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    faces.push([A[k], A[j], B[j], B[k]]);
  }
  return faces;
};
var latheFaces = (a, b, profile, sides = 24) => {
  const d = sub3(b, a);
  const L = norm3(d);
  if (L < 1e-9 || !Array.isArray(profile) || profile.length < 3) return [];
  const n = Math.max(3, Math.round(sides));
  const u = mul3(d, 1 / L);
  const [e1, e2] = basisFor(u);
  const P = profile.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [p[0], Math.max(0, p[1])]);
  if (P.length < 3) return [];
  const at = (t, r, k) => {
    const th = 2 * Math.PI * k / n;
    return add3(add3(a, mul3(u, t)), add3(mul3(e1, r * Math.cos(th)), mul3(e2, r * Math.sin(th))));
  };
  const faces = [];
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    const [t0, r0] = P[i], [t1, r1] = P[j];
    if (Math.abs(t0 - t1) < 1e-12 && Math.abs(r0 - r1) < 1e-12) continue;
    const axial0 = r0 < 1e-12, axial1 = r1 < 1e-12;
    if (axial0 && axial1) continue;
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ring = axial0 ? [at(t0, 0, 0), at(t1, r1, k), at(t1, r1, k2)] : axial1 ? [at(t0, r0, k), at(t1, 0, 0), at(t0, r0, k2)] : [at(t0, r0, k), at(t1, r1, k), at(t1, r1, k2), at(t0, r0, k2)];
      faces.push(ring);
    }
  }
  return faces;
};

// ../engine/src/matrix/meshBool.ts
var EPS = 1e-7;
var dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var sub32 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var cross32 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
var mkPoly = (v) => {
  if (v.length < 3) return null;
  const raw = cross32(sub32(v[1], v[0]), sub32(v[2], v[0]));
  const L = Math.hypot(raw[0], raw[1], raw[2]);
  if (!(L > 1e-13)) return null;
  const n = [raw[0] / L, raw[1] / L, raw[2] / L];
  return { v, n, w: dot3(n, v[0]) };
};
var flip = (p) => ({ v: [...p.v].reverse(), n: [-p.n[0], -p.n[1], -p.n[2]], w: -p.w });
var COPLANAR = 0;
var FRONT = 1;
var BACK = 2;
var SPANNING = 3;
var splitPoly = (plane, p, coF, coB, front, back) => {
  let mixed = 0;
  const types = [];
  for (const vv of p.v) {
    const t = dot3(plane.n, vv) - plane.w;
    const type = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
    mixed |= type;
    types.push(type);
  }
  if (mixed === COPLANAR) {
    (dot3(plane.n, p.n) > 0 ? coF : coB).push(p);
    return;
  }
  if (mixed === FRONT) {
    front.push(p);
    return;
  }
  if (mixed === BACK) {
    back.push(p);
    return;
  }
  const f = [], b = [];
  for (let i = 0; i < p.v.length; i++) {
    const j = (i + 1) % p.v.length;
    const ti = types[i], tj = types[j];
    const vi = p.v[i], vj = p.v[j];
    if (ti !== BACK) f.push(vi);
    if (ti !== FRONT) b.push(vi);
    if ((ti | tj) === SPANNING) {
      const denom = dot3(plane.n, sub32(vj, vi));
      const t = Math.abs(denom) > 1e-18 ? (plane.w - dot3(plane.n, vi)) / denom : 0;
      const vm = lerp3(vi, vj, t);
      f.push(vm);
      b.push(vm);
    }
  }
  const pf = mkPoly(f);
  if (pf) front.push(pf);
  const pb = mkPoly(b);
  if (pb) back.push(pb);
};
var mkNode = () => ({ plane: null, front: null, back: null, polys: [] });
var MAX_DEPTH = 400;
var build = (node, polys, depth = 0) => {
  if (!polys.length) return;
  if (!node.plane) node.plane = polys[0];
  if (depth > MAX_DEPTH) {
    for (const p of polys) node.polys.push(p);
    return;
  }
  const front = [], back = [];
  for (const p of polys) splitPoly(node.plane, p, node.polys, node.polys, front, back);
  if (front.length) {
    node.front = node.front ?? mkNode();
    build(node.front, front, depth + 1);
  }
  if (back.length) {
    node.back = node.back ?? mkNode();
    build(node.back, back, depth + 1);
  }
};
var clipPolys = (node, polys) => {
  if (!node.plane) return polys.slice();
  let front = [], back = [];
  for (const p of polys) splitPoly(node.plane, p, front, back, front, back);
  if (node.front) front = clipPolys(node.front, front);
  back = node.back ? clipPolys(node.back, back) : [];
  return front.concat(back);
};
var clipTo = (node, other) => {
  node.polys = clipPolys(other, node.polys);
  if (node.front) clipTo(node.front, other);
  if (node.back) clipTo(node.back, other);
};
var invert = (node) => {
  node.polys = node.polys.map(flip);
  if (node.plane) node.plane = flip(node.plane);
  if (node.front) invert(node.front);
  if (node.back) invert(node.back);
  const t = node.front;
  node.front = node.back;
  node.back = t;
};
var allPolys = (node) => {
  let out = node.polys.slice();
  if (node.front) out = out.concat(allPolys(node.front));
  if (node.back) out = out.concat(allPolys(node.back));
  return out;
};
var matrixToTris = (M2) => {
  if (!isRectMatrix(M2) || M2.length < 3) return [];
  const grouped = M2[0].length >= 4;
  const rings = [];
  if (!grouped) {
    rings.push(M2.map((r) => [r[0], r[1], r[2]]));
  } else {
    let cur = [];
    let key = null;
    for (const r of M2) {
      if (key !== null && r[3] !== key) {
        if (cur.length >= 3) rings.push(cur);
        cur = [];
      }
      key = r[3];
      cur.push([r[0], r[1], r[2]]);
    }
    if (cur.length >= 3) rings.push(cur);
  }
  const out = [];
  for (const ring of rings) {
    for (let i = 1; i + 1 < ring.length; i++) {
      const p = mkPoly([ring[0], ring[i], ring[i + 1]]);
      if (p) out.push(p);
    }
  }
  return out;
};
var signedVolume6 = (tris) => {
  let s = 0;
  for (const t of tris) s += dot3(t.v[0], cross32(t.v[1], t.v[2]));
  return s;
};
var orient = (tris) => signedVolume6(tris) < 0 ? tris.map(flip) : tris;
var area2 = (v) => {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    x += a[1] * b[2] - a[2] * b[1];
    y += a[2] * b[0] - a[0] * b[2];
    z += a[0] * b[1] - a[1] * b[0];
  }
  return Math.hypot(x, y, z);
};
var trisToMatrix = (tris) => {
  const out = [];
  let f = 0;
  for (const t of tris) {
    const v = t.v.map((p) => [round6(p[0]), round6(p[1]), round6(p[2])]);
    if (area2(v) < 1e-12) continue;
    for (const p of v) out.push([p[0], p[1], p[2], f]);
    f++;
  }
  return out;
};
var MAX_TRIS = 6e4;
var boolMatrix3d = (A, B, op) => {
  const ta = orient(matrixToTris(A));
  if (!ta.length) return [];
  const tb = orient(matrixToTris(B));
  if (!tb.length) return op === "intersect" ? [] : trisToMatrix(ta);
  if (ta.length + tb.length > MAX_TRIS) return trisToMatrix(ta);
  const a = mkNode(), b = mkNode();
  build(a, ta);
  build(b, tb);
  if (op === "subtract") {
    invert(a);
    clipTo(a, b);
    clipTo(b, a);
    invert(b);
    clipTo(b, a);
    invert(b);
    build(a, allPolys(b));
    invert(a);
  } else if (op === "intersect") {
    invert(a);
    clipTo(b, a);
    invert(b);
    clipTo(a, b);
    clipTo(b, a);
    build(a, allPolys(b));
    invert(a);
  } else {
    clipTo(a, b);
    clipTo(b, a);
    invert(b);
    clipTo(b, a);
    invert(b);
    build(a, allPolys(b));
  }
  return trisToMatrix(allPolys(a));
};
var cylMatrix = (seg, r, sides, rB) => {
  if (!isRectMatrix(seg) || seg[0].length < 6) return [];
  const s = seg[0];
  const faces = tubeFaces(
    [s[0], s[1], s[2]],
    [s[3], s[4], s[5]],
    Math.max(1e-5, r),
    Math.max(3, Math.round(sides) || 12),
    rB === void 0 ? void 0 : Math.max(1e-5, rB)
  );
  const out = [];
  faces.forEach((ring, f) => {
    for (const v of ring) out.push([round6(v[0]), round6(v[1]), round6(v[2]), f]);
  });
  return out;
};
var facesToMatrix = (faces) => {
  const tris = [];
  for (const ring of faces) for (let i = 1; i + 1 < ring.length; i++) {
    const p = mkPoly([ring[0], ring[i], ring[i + 1]]);
    if (p) tris.push(p);
  }
  if (!tris.length) return [];
  const flipAll = signedVolume6(tris) < 0;
  const out = [];
  faces.forEach((ring, f) => {
    const r = flipAll ? [...ring].reverse() : ring;
    for (const v of r) out.push([round6(v[0]), round6(v[1]), round6(v[2]), f]);
  });
  return out;
};
var latheMatrix = (seg, profile, sides) => {
  if (!isRectMatrix(seg) || seg[0].length < 6 || !isRectMatrix(profile) || profile.length < 3) return [];
  const s = seg[0];
  return facesToMatrix(latheFaces(
    [s[0], s[1], s[2]],
    [s[3], s[4], s[5]],
    profile.map((p) => [p[0], p[1]]),
    Math.max(3, Math.round(sides) || 24)
  ));
};
var prismMatrix = (ring, z0, z1) => {
  if (!isRectMatrix(ring) || ring.length < 3) return [];
  const wide = ring[0].length >= 3;
  let pts = [];
  if (!wide) pts = ring.map((r) => [r[0], r[1]]);
  else {
    const key = ring[0][2];
    for (const r of ring) {
      if (r[2] !== key) break;
      pts.push([r[0], r[1]]);
    }
  }
  if (pts.length < 3) return [];
  let area22 = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area22 += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  if (area22 < 0) pts = pts.reverse();
  const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
  if (!(hi - lo > 1e-9)) return [];
  const n = pts.length;
  const rings = [];
  rings.push(pts.map((p) => [p[0], p[1], lo]).reverse());
  rings.push(pts.map((p) => [p[0], p[1], hi]));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    rings.push([
      [pts[i][0], pts[i][1], lo],
      [pts[j][0], pts[j][1], lo],
      [pts[j][0], pts[j][1], hi],
      [pts[i][0], pts[i][1], hi]
    ]);
  }
  const out = [];
  rings.forEach((ring2, f) => {
    for (const v of ring2) out.push([round6(v[0]), round6(v[1]), round6(v[2]), f]);
  });
  return out;
};
var ICOSA = () => {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1]
  ];
  const s = 1 / Math.hypot(1, t);
  return {
    verts: raw.map((v) => [v[0] * s, v[1] * s, v[2] * s]),
    faces: [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1]
    ]
  };
};
var geodesicMatrix = (freq, radius, hemi = 0, centre) => {
  const f = Math.max(1, Math.min(24, Math.round(freq) || 1));
  const r = Math.abs(radius) > 1e-9 ? Math.abs(radius) : 1;
  const c = isRectMatrix(centre ?? []) && centre ? [centre[0][0] ?? 0, centre[0][1] ?? 0, centre[0][2] ?? 0] : [0, 0, 0];
  const { verts, faces } = ICOSA();
  const onSphere = (p) => {
    const L = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / L, p[1] / L, p[2] / L];
  };
  const out = [];
  for (const [ia, ib, ic] of faces) {
    const A = verts[ia];
    const B = verts[ib];
    const C = verts[ic];
    const at = (i, j) => onSphere([
      (A[0] * (f - i - j) + B[0] * i + C[0] * j) / f,
      (A[1] * (f - i - j) + B[1] * i + C[1] * j) / f,
      (A[2] * (f - i - j) + B[2] * i + C[2] * j) / f
    ]);
    for (let i = 0; i < f; i++) {
      for (let j = 0; j + i < f; j++) {
        out.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
        if (i + j + 2 <= f) out.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      }
    }
  }
  const scaled = out.map((tri) => tri.map((p) => [p[0] * r + c[0], p[1] * r + c[1], p[2] * r + c[2]])).filter((tri) => hemi ? tri.reduce((s, p) => s + (p[2] - c[2]), 0) / 3 >= -1e-9 : true);
  const m = [];
  scaled.forEach((tri, fi) => {
    for (const v of tri) m.push([round6(v[0]), round6(v[1]), round6(v[2]), fi]);
  });
  return m;
};
var sweepMatrix = (profile, rail, closed = 0) => {
  if (!isRectMatrix(profile) || profile.length < 3 || !isRectMatrix(rail) || rail.length < 2) return [];
  const prof = profile.map((p) => [p[0], p[1]]);
  const path = rail.map((p) => [p[0], p[1], p[2] ?? 0]);
  const pts = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const q = path[i];
    const p = pts[pts.length - 1];
    if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 1e-9) pts.push(q);
  }
  if (closed && pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 1e-9) pts.pop();
  }
  if (pts.length < 2) return [];
  const nrm = (v) => {
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot32 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const n = pts.length;
  const tan = pts.map((_, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    return nrm([next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]);
  });
  let u = Math.abs(tan[0][2]) < 0.9 ? nrm(crs(tan[0], [0, 0, 1])) : nrm(crs(tan[0], [1, 0, 0]));
  const sections = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = crs(tan[i - 1], tan[i]);
      const sinA = Math.hypot(axis[0], axis[1], axis[2]);
      if (sinA > 1e-9) {
        const k = nrm(axis);
        const ang = Math.atan2(sinA, dot32(tan[i - 1], tan[i]));
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const kxu = crs(k, u);
        const kdu = dot32(k, u);
        u = nrm([
          u[0] * ca + kxu[0] * sa + k[0] * kdu * (1 - ca),
          u[1] * ca + kxu[1] * sa + k[1] * kdu * (1 - ca),
          u[2] * ca + kxu[2] * sa + k[2] * kdu * (1 - ca)
        ]);
      }
    }
    const v = nrm(crs(tan[i], u));
    const o = pts[i];
    sections.push(prof.map((p) => [
      o[0] + u[0] * p[0] + v[0] * p[1],
      o[1] + u[1] * p[0] + v[1] * p[1],
      o[2] + u[2] * p[0] + v[2] * p[1]
    ]));
  }
  if (closed) sections.push(sections[0]);
  return facesToMatrix(loftFaces(sections));
};

// ../engine/src/matrix/curves.ts
var samples = (n) => Math.max(2, Math.min(4096, Math.round(n) || 2));
var clean = (pts) => pts.map((p) => p.map(round6));
var controlPoints = (M2, least = 2) => {
  if (!isRectMatrix(M2) || M2.length < least) return null;
  const d = Math.min(3, Math.max(2, M2[0].length));
  return M2.map((r) => d === 2 ? [r[0], r[1]] : [r[0], r[1], r[2] ?? 0]);
};
var lerpPt = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
var bezierMatrix = (ctrl, n) => {
  const P = controlPoints(ctrl);
  if (!P) return [];
  const count = samples(n);
  const out = [];
  for (let s = 0; s < count; s++) {
    const t = s / (count - 1);
    const work = P.map((p) => p.slice());
    for (let r = 1; r < work.length; r++) {
      for (let j = 0; j + r < work.length; j++) work[j] = lerpPt(work[j], work[j + 1], t);
    }
    out.push(work[0]);
  }
  return clean(out);
};
var clampedKnots = (m, degree) => {
  const U = [];
  for (let i = 0; i <= m + degree; i++) {
    if (i <= degree) U.push(0);
    else if (i >= m) U.push(1);
    else U.push((i - degree) / (m - degree));
  }
  return U;
};
var knotSpan = (U, m, degree, u) => {
  if (u >= U[m]) return m - 1;
  let lo = degree;
  let hi = m;
  while (hi - lo > 1) {
    const mid = lo + hi >> 1;
    if (u < U[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
};
var deBoor = (P, U, degree, u) => {
  const k = knotSpan(U, P.length, degree, u);
  const d = [];
  for (let j = 0; j <= degree; j++) d.push(P[j + k - degree].slice());
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const lo = U[j + k - degree];
      const hi = U[j + 1 + k - r];
      const alpha = hi - lo > 1e-12 ? (u - lo) / (hi - lo) : 0;
      d[j] = lerpPt(d[j - 1], d[j], alpha);
    }
  }
  return d[degree];
};
var bsplineMatrix = (ctrl, degree, n) => {
  const P = controlPoints(ctrl);
  if (!P) return [];
  const p = Math.max(1, Math.min(Math.round(degree) || 3, P.length - 1));
  const U = clampedKnots(P.length, p);
  const count = samples(n);
  const out = [];
  for (let s = 0; s < count; s++) out.push(deBoor(P, U, p, s / (count - 1)));
  return clean(out);
};
var nurbsMatrix = (ctrl, w, degree, n) => {
  const P = controlPoints(ctrl);
  if (!P) return [];
  const dim = P[0].length;
  const weightAt = (i) => {
    const raw = isRectMatrix(w) ? w[i]?.[0] ?? w[0]?.[i] ?? 1 : 1;
    return Number.isFinite(raw) && raw > 1e-9 ? raw : 1;
  };
  const H = P.map((pt, i) => {
    const wi = weightAt(i);
    return [...pt.map((v) => v * wi), wi];
  });
  const p = Math.max(1, Math.min(Math.round(degree) || 3, H.length - 1));
  const U = clampedKnots(H.length, p);
  const count = samples(n);
  const out = [];
  for (let s = 0; s < count; s++) {
    const h = deBoor(H, U, p, s / (count - 1));
    const wEnd = h[dim];
    const inv = Math.abs(wEnd) > 1e-12 ? 1 / wEnd : 0;
    out.push(h.slice(0, dim).map((v) => v * inv));
  }
  return clean(out);
};
var catenaryParam = (L, sag) => {
  const target = Math.max(1e-6, sag);
  const droop = (a) => a * (Math.cosh(L / (2 * a)) - 1);
  let lo = 1e-6;
  let hi = Math.max(L, 1);
  for (let i = 0; i < 60 && droop(hi) > target; i++) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (droop(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
var catenaryMatrix = (seg, sag, n) => {
  if (!isRectMatrix(seg)) return [];
  let a;
  let b;
  if (seg[0].length >= 6) {
    a = [seg[0][0], seg[0][1], seg[0][2]];
    b = [seg[0][3], seg[0][4], seg[0][5]];
  } else if (seg.length >= 2 && seg[0].length >= 2) {
    a = [seg[0][0], seg[0][1], seg[0][2] ?? 0];
    b = [seg[1][0], seg[1][1], seg[1][2] ?? 0];
  } else return [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  const count = samples(n);
  if (L < 1e-9) {
    const out2 = [];
    for (let s = 0; s < count; s++) out2.push(lerpPt(a, b, s / (count - 1)));
    return clean(out2);
  }
  const aa = catenaryParam(L, sag);
  const half = Math.cosh(L / (2 * aa));
  const out = [];
  for (let s = 0; s < count; s++) {
    const u = s / (count - 1);
    const x = L * u;
    const drop = aa * (Math.cosh((x - L / 2) / aa) - half);
    out.push([a[0] + dx * u, a[1] + dy * u, a[2] + (b[2] - a[2]) * u + drop]);
  }
  return clean(out);
};
var arclenMatrix = (pts) => {
  const P = controlPoints(pts, 1);
  if (!P) return [];
  const out = [[0]];
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0));
    out.push([round6(acc)]);
  }
  return out;
};
var resampleMatrix = (pts, n) => {
  const P = controlPoints(pts, 2);
  if (!P) return [];
  const count = samples(n);
  const cum = [0];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0)));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-12) return clean(new Array(count).fill(P[0]));
  const out = [];
  let seg = 0;
  for (let s = 0; s < count; s++) {
    const target = total * s / (count - 1);
    while (seg < P.length - 2 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 1e-12 ? (target - cum[seg]) / span : 0;
    out.push(lerpPt(P[seg], P[seg + 1], t));
  }
  return clean(out);
};

// ../engine/src/expr/exprCatalog.ts
var M = (name, about, optional) => ({ name, about, ...optional ? { optional: true } : {} });
var EXPR_FUNCTIONS = [
  // ── Math ─────────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Math.Floor", bare: "floor", namespace: "Math", params: [M("x", "value")], summary: "Round down to the nearest integer." },
  { qualified: "Math.Ceil", bare: "ceil", namespace: "Math", params: [M("x", "value")], summary: "Round up to the nearest integer." },
  { qualified: "Math.Round", bare: "round", namespace: "Math", params: [M("x", "value")], summary: "Round to the nearest integer." },
  { qualified: "Math.Abs", bare: "abs", namespace: "Math", params: [M("x", "value")], summary: "Magnitude, dropping the sign." },
  { qualified: "Math.Sqrt", bare: "sqrt", namespace: "Math", params: [M("x", "value")], summary: "Square root." },
  { qualified: "Math.Sign", bare: "sign", namespace: "Math", params: [M("x", "value")], summary: "\u22121, 0 or +1. Vectorises an orientation test.", example: "sign(sum(cross(P, shift(P,-1))))" },
  { qualified: "Math.Pow", bare: "pow", namespace: "Math", params: [M("x", "base"), M("y", "exponent")], summary: "x raised to y (the `^` operator in function form)." },
  { qualified: "Math.Cos", bare: "cos", namespace: "Math", params: [M("radians", "angle in radians")], summary: "Cosine. `PI` is in scope." },
  { qualified: "Math.Sin", bare: "sin", namespace: "Math", params: [M("radians", "angle in radians")], summary: "Sine. `PI` is in scope." },
  { qualified: "Math.Tan", bare: "tan", namespace: "Math", params: [M("radians", "angle in radians")], summary: "Tangent." },
  { qualified: "Math.Atan2", bare: "atan2", namespace: "Math", params: [M("y", "rise"), M("x", "run")], summary: "Signed angle of the vector (x, y), in radians." },
  { qualified: "Math.Log", bare: "log", namespace: "Math", params: [M("x", "value > 0")], summary: "Natural log. Values \u2264 0 give 0, so one bad cell can't poison a broadcast." },
  { qualified: "Math.Log2", bare: "log2", namespace: "Math", params: [M("x", "value > 0")], summary: "Base-2 log \u2014 semitones, octaves, bit depth." },
  { qualified: "Math.Log10", bare: "log10", namespace: "Math", params: [M("x", "value > 0")], summary: "Base-10 log \u2014 decibels, pH, Richter." },
  { qualified: "Math.Exp", bare: "exp", namespace: "Math", params: [M("x", "exponent")], summary: "e raised to x \u2014 decay and growth curves." },
  // ── Matrix ───────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Matrix.Transpose", bare: "T", namespace: "Matrix", params: [M("A", "matrix")], summary: "Flip rows and columns. Turns a column of i-values into a row, which is how a pairwise table is built.", example: "T(arange(n))" },
  { qualified: "Matrix.Inverse", bare: "inv", namespace: "Matrix", params: [M("A", "square matrix")], summary: "Matrix inverse. Prefer Matrix.Solve for a linear system." },
  { qualified: "Matrix.Solve", bare: "solve", namespace: "Matrix", params: [M("A", "coefficients"), M("b", "right-hand side")], summary: "Solve A\xB7x = b." },
  { qualified: "Matrix.Kron", bare: "kron", namespace: "Matrix", params: [M("A", "left"), M("B", "right")], summary: "Kronecker product. `kron(col, ones(4,1))` repeats each value 4\xD7; `kron(ones(n,1), pattern)` tiles a pattern n\xD7.", example: "kron(ones(n,1), corner)" },
  { qualified: "Matrix.Rows", bare: "rows", namespace: "Matrix", params: [M("A", "matrix")], summary: "Row count." },
  { qualified: "Matrix.Cols", bare: "cols", namespace: "Matrix", params: [M("A", "matrix")], summary: "Column count." },
  { qualified: "Matrix.Reshape", bare: "reshape", namespace: "Matrix", params: [M("A", "matrix"), M("rows", "new row count"), M("cols", "new column count")], summary: "Re-lay the cells row-major. With HCat this is how two lists interleave.", example: "reshape(hcat(A, B), rows(A)*2, 2)" },
  { qualified: "Matrix.Sub", bare: "sub", namespace: "Matrix", params: [M("A", "matrix"), M("row", "first row"), M("col", "first column"), M("rows", "how many rows"), M("cols", "how many columns")], summary: "Rectangular slice by CONSTANT indices." },
  { qualified: "Matrix.Row", bare: "row", namespace: "Matrix", params: [M("A", "matrix"), M("i", "row index")], summary: "One row. Inside a loop, `i` may be the loop variable \u2014 a gather by computed index." },
  { qualified: "Matrix.Col", bare: "col", namespace: "Matrix", params: [M("A", "matrix"), M("j", "column index")], summary: "One column." },
  { qualified: "Matrix.HCat", bare: "hcat", namespace: "Matrix", params: [M("A", "matrix"), M("B", "matrix"), M("\u2026", "more matrices", true)], summary: "Join side by side (same row count). Empty is the identity, so it works as a loop accumulator." },
  { qualified: "Matrix.VCat", bare: "vcat", namespace: "Matrix", params: [M("A", "matrix"), M("B", "matrix"), M("\u2026", "more matrices", true)], summary: "Stack vertically (same column count). The standard accumulator: `A = vcat(A, part)`.", example: "A = vcat(A, ring)" },
  { qualified: "Matrix.Eye", bare: "eye", namespace: "Matrix", params: [M("n", "size")], summary: "n\xD7n identity matrix." },
  { qualified: "Matrix.Zeros", bare: "zeros", namespace: "Matrix", params: [M("rows", "row count"), M("cols", "column count", true)], summary: "Matrix of zeros \u2014 also the seed for a VCat accumulator: `zeros(0,2)`." },
  { qualified: "Matrix.Ones", bare: "ones", namespace: "Matrix", params: [M("rows", "row count"), M("cols", "column count", true)], summary: "Matrix of ones. Broadcasting a column of ones is how a value is spread over a shape." },
  { qualified: "Matrix.Fill", bare: "fill", namespace: "Matrix", params: [M("rows", "row count"), M("cols", "column count"), M("value", "cell value")], summary: "Matrix of one repeated value \u2014 a wired size, which no node can produce.", example: "fill(rows(P), 1, i)" },
  { qualified: "Matrix.Range", bare: "arange", namespace: "Matrix", params: [M("n", "count, or start when `end` given"), M("end", "exclusive end", true)], summary: "Column of consecutive integers \u2014 the index list every pairwise table is built from." },
  { qualified: "Matrix.Diag", bare: "diag", namespace: "Matrix", params: [M("A", "matrix or column")], summary: "Diagonal of a matrix, or a diagonal matrix from a column." },
  { qualified: "Matrix.Shift", bare: "shift", namespace: "Matrix", params: [M("A", "matrix"), M("k", "offset \u2014 \u22121 is the NEXT row, +1 the PREVIOUS"), M("axis", '"rows" (default) or "cols"', true)], summary: "Cyclic roll. `shift(P,-1)` is the neighbour list that turns a per-edge loop into one expression.", example: "E = shift(P,-1) - P" },
  { qualified: "Matrix.Sort", bare: "sort", namespace: "Matrix", params: [M("A", "matrix"), M("axis", '"rows" (default) or "cols"', true)], summary: "Sort the values INSIDE each row (or column)." },
  { qualified: "Matrix.SortBy", bare: "sortby", namespace: "Matrix", params: [M("A", "matrix"), M("key", "key column, or a column index")], summary: "Permute whole ROWS by a key, so a point travels with its key.", example: "sortby(P, angle(P - c))" },
  { qualified: "Matrix.Compress", bare: "compress", namespace: "Matrix", params: [M("A", "matrix"), M("mask", "0/1 per row")], summary: "Drop the rows whose mask cell is 0 \u2014 the one operation whose OUTPUT LENGTH is data." },
  { qualified: "Matrix.Where", bare: "where", namespace: "Matrix", params: [M("mask", "0/1 per cell"), M("A", "value where 1"), M("B", "value where 0")], summary: "Element-wise ternary. The operators can't do this: `?:` tests a matrix's [0][0] cell.", example: "where(fill(rows(P),2,ok), R, P)" },
  // ── Vector ───────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Vector.Normalize", bare: "normalize", namespace: "Vector", params: [M("V", "N\xD72 vectors")], summary: "Scale each row to unit length." },
  { qualified: "Vector.Perp", bare: "perp", namespace: "Vector", params: [M("V", "N\xD72 vectors")], summary: "Rotate each row 90\xB0 counter-clockwise: (x, y) \u2192 (\u2212y, x)." },
  { qualified: "Vector.PerpCW", bare: "perpcw", namespace: "Vector", params: [M("V", "N\xD72 vectors")], summary: "Rotate each row 90\xB0 clockwise: (x, y) \u2192 (y, \u2212x)." },
  { qualified: "Vector.Length", bare: "len", namespace: "Vector", params: [M("V", "N\xD72 vectors")], summary: "Length of each row.", example: "sum(len(shift(P,-1) - P))" },
  { qualified: "Vector.Dot", bare: "dot", namespace: "Vector", params: [M("A", "N\xD72 vectors"), M("B", "N\xD72 vectors")], summary: "Row-wise dot product." },
  { qualified: "Vector.Cross", bare: "cross", namespace: "Vector", params: [M("A", "N\xD72 vectors"), M("B", "N\xD72 vectors")], summary: "Row-wise 2D cross (a scalar per row). Summed over a ring it is twice the signed area.", example: "area = abs(sum(cross(P, shift(P,-1)))) / 2" },
  { qualified: "Vector.Angle", bare: "angle", namespace: "Vector", params: [M("A", "N\xD72 vectors"), M("B", "second list \u2014 omit for each row's own direction", true)], summary: "Direction of each row, or the signed angle between two lists." },
  // ── Reduce ───────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Reduce.Sum", bare: "sum", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default) \u2192 a number; "rows" / "cols" \u2192 a matrix', true)], summary: 'Total. On "all" it returns a plain number, so it can drive a numeric param directly.' },
  { qualified: "Reduce.Mean", bare: "mean", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Average \u2014 a centroid is `mean(P, 'cols')`." },
  { qualified: "Reduce.Product", bare: "prod", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Product of the cells." },
  { qualified: "Reduce.Min", bare: "min", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Smallest cell." },
  { qualified: "Reduce.Max", bare: "max", namespace: "Reduce", params: [M("A", "matrix"), M("axis", '"all" (default), "rows" or "cols"', true)], summary: "Largest cell." },
  // ── Compare ──────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Compare.Greater", bare: "gt", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A > B, cell by cell." },
  { qualified: "Compare.Less", bare: "lt", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A < B, cell by cell." },
  { qualified: "Compare.GreaterEqual", bare: "ge", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A \u2265 B, cell by cell." },
  { qualified: "Compare.LessEqual", bare: "le", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A \u2264 B, cell by cell." },
  { qualified: "Compare.Equal", bare: "eq", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A = B \u2014 how an index is tested against a whole column of indices.", example: "eq(K, i)" },
  { qualified: "Compare.NotEqual", bare: "ne", namespace: "Compare", params: [M("A", "matrix or number"), M("B", "matrix or number")], summary: "Mask of A \u2260 B, cell by cell." },
  // ── Shape (2D) ───────────────────────────────────────────────────────────────────────────────────
  { qualified: "Shape.Union", bare: "union", namespace: "Shape", params: [M("A", "ring list"), M("B", "ring list")], summary: "Merge two 2D shapes. Even-odd aware, so holes survive." },
  { qualified: "Shape.Subtract", bare: "subtract", namespace: "Shape", params: [M("A", "ring list"), M("B", "cutter")], summary: "Cut B out of A." },
  { qualified: "Shape.Intersect", bare: "intersect", namespace: "Shape", params: [M("A", "ring list"), M("B", "ring list")], summary: "Keep only the overlap." },
  { qualified: "Shape.Xor", bare: "xor", namespace: "Shape", params: [M("A", "ring list"), M("B", "ring list")], summary: "Keep what belongs to exactly one of the two." },
  { qualified: "Shape.PointInside", bare: "inpoly", namespace: "Shape", params: [M("P", "N\xD72 points"), M("ring", "polygon")], summary: "0/1 per point \u2014 the trimming counterpart of a boolean, with no clipping at all." },
  // ── Solid (3D) ───────────────────────────────────────────────────────────────────────────────────
  { qualified: "Solid.Union", bare: "munion", namespace: "Solid", params: [M("A", "face list"), M("B", "face list")], summary: "Merge two solids (BSP CSG) on the [x,y,z,f] list a Polyhedron row reads." },
  { qualified: "Solid.Subtract", bare: "msubtract", namespace: "Solid", params: [M("A", "face list"), M("B", "cutter")], summary: "Drill / cut B out of A." },
  { qualified: "Solid.Intersect", bare: "mintersect", namespace: "Solid", params: [M("A", "face list"), M("B", "face list")], summary: "Keep only the common volume." },
  { qualified: "Solid.Cylinder", bare: "mcyl", namespace: "Solid", params: [M("axis", "segment [x1,y1,z1,x2,y2,z2]"), M("radius", "metres"), M("sides", "facets (default 12)", true), M("radius2", "far-end radius, for a taper", true)], summary: "A cylinder along an axis \u2014 the drill for Solid.Subtract." },
  { qualified: "Solid.Prism", bare: "mprism", namespace: "Solid", params: [M("ring", "footprint"), M("z0", "base height"), M("z1", "top height")], summary: "Extrude a footprint between two heights.", example: "Mesh = mprism(Q, 0, h)" },
  { qualified: "Solid.Lathe", bare: "mlathe", namespace: "Solid", params: [M("profile", "half-section points"), M("axis", "segment to revolve about"), M("steps", "facets (default 24)", true)], summary: "Revolve a profile \u2014 the right way to build a hollow body, far cheaper than a boolean." },
  { qualified: "Solid.Geodesic", bare: "geodesic", namespace: "Solid", params: [M("freq", "subdivision frequency \u2014 2V, 3V, 4V \u2026"), M("radius", "metres"), M("hemi", "non-zero for a DOME, not a sphere", true), M("centre", "[x,y,z] row (default origin)", true)], summary: "A geodesic sphere or dome at any frequency \u2014 class I subdivision of an icosahedron, 20\xB7freq\xB2 faces.", example: "Dome = geodesic(4, 6, 1, hcat(cx, cy, 0))" },
  { qualified: "Solid.Sweep", bare: "msweep", namespace: "Solid", params: [M("profile", "N\xD72 cross-section in the section's own (u,v)"), M("rail", "M\xD73 path"), M("closed", "non-zero to close the loop", true)], summary: "Carry a cross-section along a 3D path \u2014 handrail, pipe run, cornice, stringer. Parallel-transport frames, so it never twists or flips where the rail goes vertical.", example: "Rail = msweep(sect, bspline(ctrl, 3, 80))" },
  // ── Curve ────────────────────────────────────────────────────────────────────────────────────────
  { qualified: "Curve.Bezier", bare: "bezier", namespace: "Curve", params: [M("ctrl", "control points, N\xD72 or N\xD73"), M("n", "samples (default 32)", true)], summary: "A Bezier of ANY degree by de Casteljau \u2014 degree follows the control count.", example: "Side = bezier(vcat(A, B, C), 26)" },
  { qualified: "Curve.BSpline", bare: "bspline", namespace: "Curve", params: [M("ctrl", "control points"), M("degree", "default 3", true), M("n", "samples (default 64)", true)], summary: "Clamped uniform B-spline. Unlike a Bezier the degree stays fixed as points are added, so each handle is LOCAL \u2014 the curve for a long fairing run.", example: "Road = bspline(pts, 3, 200)" },
  { qualified: "Curve.NURBS", bare: "nurbs", namespace: "Curve", params: [M("ctrl", "control points"), M("w", "one weight per control point"), M("degree", "default 3", true), M("n", "samples (default 64)", true)], summary: "A weighted B-spline \u2014 the only curve here that is EXACT rather than close: a weighted quadratic reproduces a true circular arc.", example: "Arc = nurbs(P, vcat(1, 0.7071, 1), 2, 40)" },
  { qualified: "Curve.Catenary", bare: "catenary", namespace: "Curve", params: [M("axis", "segment [x1,y1,z1,x2,y2,z2]"), M("sag", "droop at mid-span, metres"), M("n", "samples (default 32)", true)], summary: "The hanging curve between two points \u2014 a cable, a chain, a draped edge. Ends are exact; the cosh parameter is solved from the sag you asked for.", example: "Cable = catenary(seg, 0.8, 48)" },
  { qualified: "Curve.ArcLength", bare: "arclen", namespace: "Curve", params: [M("pts", "point list")], summary: "Cumulative length down a polyline, as an N\xD71 column starting at 0." },
  { qualified: "Curve.Resample", bare: "resample", namespace: "Curve", params: [M("pts", "point list"), M("n", "output points (default 32)", true)], summary: "Respace a polyline EVENLY BY ARC LENGTH. Curve evaluators sample in the parameter, which bunches points where the curve is tight; anything placed along the result needs even spacing in the world.", example: "Posts = resample(Rail, 14)" }
];
var EXPR_ALIASES = Object.fromEntries(
  EXPR_FUNCTIONS.map((f) => [f.qualified.toLowerCase(), f.bare])
);
var EXPR_BY_BARE = Object.fromEntries(EXPR_FUNCTIONS.map((f) => [f.bare, f]));

// ../engine/src/expr/exprAlgorithms.ts
var EXPR_ALGORITHMS = [
  {
    qualified: "Algorithms.Inset",
    params: [
      { name: "P", about: "Outline as an N\xD72 point matrix" },
      { name: "inset", about: "Offset in metres \u2014 positive inward, negative outward" }
    ],
    returns: "Q",
    summary: "Offset a closed outline by a constant distance, mitring every corner.",
    source: "Library/Tools/New Tools/inset_with_math.json",
    example: "Q = Algorithms.Inset(P, 0.3)",
    // The MITER-VECTOR offset. Each edge has an inward normal; a vertex moves along the sum of the two
    // normals meeting there, scaled by 1/(1 + n·n') so the offset distance stays exact however sharp the
    // corner is. Loop-free: `shift` supplies the neighbour list, so this is the whole algorithm.
    body: [
      "E = shift(P, -1) - P",
      "n = perp(normalize(E))",
      "np = shift(n, 1)",
      "M = (n + np) / (1 + dot(n, np))",
      "Q = P + inset * M"
    ].join("\n")
  },
  {
    qualified: "Algorithms.ConvexHull",
    params: [
      { name: "P", about: "Point cloud as an N\xD72 matrix" },
      { name: "tol", about: "Angular tolerance in DEGREES \u2014 how flat a turn may be and still be dropped" }
    ],
    returns: "Q",
    summary: "Smallest convex outline containing every point, wound counter-clockwise.",
    source: "Library/Tools/New Tools/convex_hull_with_math.json",
    example: "H = Algorithms.ConvexHull(P, 0.5)",
    // Loop-free: every point is kept or dropped by ONE test — sort the directions to all other points and
    // ask whether the widest angular gap exceeds a half-turn. A point with such a gap has all the others to
    // one side of it, which is exactly the definition of a hull vertex.
    body: [
      "X = col(P,0)",
      "Y = col(P,1)",
      "DX = X - T(X)",
      "DY = Y - T(Y)",
      "Dg = le(DX^2 + DY^2, 1e-9)",
      "A = atan2(DY, DX)",
      "Am = A - 100 * Dg",
      "mx = max(Am, 'rows')",
      "A2 = where(Dg, mx, Am)",
      "S = sort(A2, 'rows')",
      "G = shift(S, -1, 'cols') - S",
      "Gw = G + 2 * PI * lt(G, 0)",
      "keep = gt(max(Gw, 'rows'), PI + tol * PI / 180)",
      "H = compress(P, keep)",
      "c = mean(H, 'cols')",
      "R = sortby(H, angle(H - c))",
      "D = R - shift(R, 1)",
      "U = gt(sum(D^2, 'rows'), 1e-12)",
      "Q = compress(R, U)"
    ].join("\n")
  },
  {
    qualified: "Algorithms.Voronoi",
    params: [
      { name: "P", about: "Boundary outline as an N\xD72 point matrix \u2014 cells are clipped to it" },
      { name: "seeds", about: "How many cells (default 4) \u2014 OR an N\xD72 matrix of seed points to use instead", optional: true },
      { name: "jitter", about: "0\u20260.5, how far each seed is pushed off its lattice cell. 0 (the default) is a regular lattice", optional: true },
      { name: "gx", about: "Seeds per row. 0 (the default) picks the grid from the outline's aspect ratio", optional: true }
    ],
    returns: "E",
    summary: "Voronoi cells clipped to a boundary, returned as edge segments [x1, y1, x2, y2]. Seeds itself.",
    source: "Library/Tools/New Tools/voronoi_with_math.json",
    example: "E = Algorithms.Voronoi(P, 6)",
    // SEEDS ITSELF, so a call needs nothing but the outline. `seeds` is polymorphic on WIDTH — a 1-column
    // value is a COUNT and the lattice below is built; anything 2 columns wide is a seed-point matrix and is
    // used as-is, which is what keeps the older `Voronoi(P, S)` call working unchanged. A missing argument
    // arrives as 0, so each default is expressed as a guard rather than needing engine support: 0 seeds → 4,
    // and jitter / gx default to 0, whose meaning (regular lattice, automatic grid) is deliberately the same
    // as "not supplied" — a value that means something ELSE at 0 could not have a non-zero default at all.
    //
    // Then each cell is the boundary clipped by one half-plane per OTHER seed (the perpendicular bisector),
    // via the Sutherland–Hodgman interleave: keep-flags and crossing points woven together, then compressed.
    // The final line composes the two accumulators into one segment list, since a call returns one value.
    body: [
      "# Seeds",
      "_isM = cols(seeds) > 1",
      "_n = _isM ? rows(seeds) : (seeds > 0 ? seeds : 4)",
      "_x0 = min(col(P,0))",
      "_x1 = max(col(P,0))",
      "_y0 = min(col(P,1))",
      "_y1 = max(col(P,1))",
      "_w = max(_x1 - _x0, 1e-9)",
      "_h = max(_y1 - _y0, 1e-9)",
      "_gx = gx > 0 ? gx : max(1, min(_n, round(sqrt(_n * _w / _h))))",
      "_gy = ceil(_n / _gx)",
      "_k = arange(_n)",
      "_u = ((_k % _gx) + 0.5) / _gx",
      "_v = (floor(_k / _gx) + 0.5) / _gy",
      "_jx = jitter * sin(_k * 12.9898 + 1.3) / _gx",
      "_jy = jitter * sin(_k * 78.233 + 4.7) / _gy",
      "S = _isM ? seeds : hcat(_x0 + (_u + _jx) * _w, _y0 + (_v + _jy) * _h)",
      "# Cells",
      "n = rows(S)",
      "A = zeros(0,2)",
      "B = zeros(0,2)",
      "loop i in n:",
      "  si = row(S,i)",
      "  C = P",
      "  loop j in n:",
      "    sj = row(S,j)",
      "    m = (si + sj) / 2",
      "    nv = si - sj",
      "    d = dot(C - m, nv)",
      "    dn = shift(d, -1)",
      "    Cn = shift(C, -1)",
      "    t = d / (d - dn)",
      "    X = C + t * (Cn - C)",
      "    kv = ge(d, 0)",
      "    kx = abs(ge(d,0) - ge(dn,0))",
      "    C = compress(reshape(hcat(C, X), 2*rows(C), 2), reshape(hcat(kv, kx), 2*rows(C), 1))",
      "  end",
      "  A = vcat(A, C)",
      "  B = vcat(B, shift(C,-1))",
      "end",
      "E = hcat(A, B)"
    ].join("\n")
  },
  {
    qualified: "Algorithms.MiteredJoin",
    params: [
      { name: "Ga", about: "Edge start points, N\xD72 \u2014 Points to Graph in Pairs mode gives these" },
      { name: "Gb", about: "Edge end points, N\xD72" },
      { name: "Gt", about: "Per-edge thickness, N\xD71 \u2014 0 falls back to the width argument" },
      { name: "width", about: "Default band width in metres" },
      { name: "capEnds", about: "1 extends a free end by half its width, 0 leaves it flush" },
      { name: "merge", about: "Distance below which two endpoints count as the same junction" }
    ],
    returns: "Q",
    summary: "Thicken a graph into seamless mitred bands \u2014 one grouped ring per edge, joints solved at each junction.",
    source: "Library/Tools/New Tools/mitered_join_with_math.json",
    example: "Q = Algorithms.MiteredJoin(Ga, Gb, Gt, 0.15, 1, 0.01)",
    // Every endpoint is assigned a canonical junction id from the pairwise distance table, spokes are put in
    // angular order round each junction, and each band edge is mitred against its neighbour's opposite edge.
    // Output is the grouped [x, y, ring] list a Polygon row reads, so the bands arrive as separate outlines.
    body: [
      "_BIG = 1e18",
      "_TOL = merge",
      "_MAXM = 20",
      "_HWMIN = 0.0025",
      "_live = gt(len(Gb - Ga), 1e-9)",
      "_A0 = compress(Ga, _live)",
      "_B0 = compress(Gb, _live)",
      "_n = rows(_A0)",
      "_tk = compress(Gt, _live)",
      "_hw = max(where(gt(_tk, 0), _tk, width), 0.02) / 2",
      "_U = normalize(_B0 - _A0)",
      "_EX = vcat(col(_A0,0), col(_B0,0))",
      "_EY = vcat(col(_A0,1), col(_B0,1))",
      "_DEG = sum(le((_EX - T(_EX)) * (_EX - T(_EX)) + (_EY - T(_EY)) * (_EY - T(_EY)), _TOL * _TOL), 'rows')",
      "_free = capEnds > 0 ? eq(_DEG, 1) : zeros(2*_n,1)",
      "A = _A0 - sub(_free,0,0,_n,1) * _hw * _U",
      "B = _B0 + sub(_free,_n,0,_n,1) * _hw * _U",
      "_NP = vcat(A, B)",
      "_DIR = vcat(_U, 0 - _U)",
      "_HW = vcat(_hw, _hw)",
      "_k2 = arange(2 * _n)",
      "_R2 = T(_k2)",
      "_QX = col(_NP,0)",
      "_QY = col(_NP,1)",
      "_D2 = (_QX - T(_QX)) * (_QX - T(_QX)) + (_QY - T(_QY)) * (_QY - T(_QY))",
      "_NID = min(where(le(_D2, _TOL * _TOL), _R2, _BIG), 'rows')",
      "_ANG = angle(_DIR)",
      "_KEY = _NID * 1000 + _ANG + 180",
      "S = sortby(hcat(hcat(hcat(hcat(_NP, _DIR), _HW), _NID), _k2), _KEY)",
      "_sn = col(S,5)",
      "_EQ = eq(_sn, T(_sn))",
      "_FIRST = min(where(_EQ, _R2, _BIG), 'rows')",
      "_LAST = max(where(_EQ, _R2, 0 - _BIG), 'rows')",
      "_NEXTI = where(le(_k2 + 1, _LAST), _k2 + 1, _FIRST)",
      "_PREVI = where(ge(_k2 - 1, _FIRST), _k2 - 1, _LAST)",
      "_SN = eq(_NEXTI, _R2) @ S",
      "_SP = eq(_PREVI, _R2) @ S",
      "Pos = sub(S,0,0,2*_n,2)",
      "Dir = sub(S,0,2,2*_n,2)",
      "Hw = col(S,4)",
      "LA = Pos + Hw * perp(Dir)",
      "RA = Pos + Hw * perpcw(Dir)",
      "_PosN = sub(_SN,0,0,2*_n,2)",
      "_DirN = sub(_SN,0,2,2*_n,2)",
      "_HwN = col(_SN,4)",
      "_RAN = _PosN + _HwN * perpcw(_DirN)",
      "_PosP = sub(_SP,0,0,2*_n,2)",
      "_DirP = sub(_SP,0,2,2*_n,2)",
      "_HwP = col(_SP,4)",
      "_LAP = _PosP + _HwP * perp(_DirP)",
      "_dn1 = cross(Dir, _DirN)",
      "_ok1 = gt(abs(_dn1), 1e-10)",
      "_t1 = cross(_RAN - LA, _DirN) / _dn1",
      "LC = where(_ok1, LA + _t1 * Dir, (LA + _RAN) / 2)",
      "_dn2 = cross(_DirP, Dir)",
      "_ok2 = gt(abs(_dn2), 1e-10)",
      "_t2 = cross(RA - _LAP, Dir) / _dn2",
      "RC = where(_ok2, _LAP + _t2 * _DirP, (_LAP + RA) / 2)",
      "_hwLA = max((Hw + _HwN) / 2, _HWMIN)",
      "_hwRA = max((_HwP + Hw) / 2, _HWMIN)",
      "_fL = min(1, _MAXM * _hwLA / max(len(LC - Pos), 1e-12))",
      "_fR = min(1, _MAXM * _hwRA / max(len(RC - Pos), 1e-12))",
      "LC = Pos + (LC - Pos) * _fL",
      "RC = Pos + (RC - Pos) * _fR",
      "_one = eq(_FIRST, _LAST)",
      "LC = where(_one, LA, LC)",
      "RC = where(_one, RA, RC)",
      "_BACK = eq(_k2, T(col(S,6)))",
      "_LCo = _BACK @ LC",
      "_RCo = _BACK @ RC",
      "LF = sub(_LCo,0,0,_n,2)",
      "RF = sub(_RCo,0,0,_n,2)",
      "LT = sub(_LCo,_n,0,_n,2)",
      "RT = sub(_RCo,_n,0,_n,2)",
      "Q = zeros(0,3)",
      "loop i in _n:",
      "  _a = row(A,i)",
      "  _b = row(B,i)",
      "  _u = row(_U,i)",
      "  _P4 = vcat(vcat(vcat(row(LF,i), row(LT,i)), row(RF,i)), row(RT,i))",
      "  _dd = _P4 - _a",
      "  _sd = cross(_u, _dd)",
      "  _al = dot(_dd, _u)",
      "  _mL = gt(_sd, 1e-9)",
      "  _mR = lt(_sd, 0 - 1e-9)",
      "  _L = sortby(compress(_P4, _mL), compress(_al, _mL))",
      "  _R = sortby(compress(_P4, _mR), 0 - compress(_al, _mR))",
      "  _ring = vcat(vcat(vcat(_a, _L), _b), _R)",
      "  Q = vcat(Q, hcat(_ring, fill(rows(_ring),1,i)))",
      "end"
    ].join("\n")
  },
  {
    qualified: "Algorithms.Straight_skeleton",
    params: [
      { name: "P", about: "Outline as an N\xD72 point matrix \u2014 either winding" },
      { name: "merge", about: "Merge tolerance in metres \u2014 two wavefront vertices this close count as one (0.002 is the source flow's default)" }
    ],
    returns: "E",
    summary: "Full event-driven straight skeleton of an outline, returned as arc segments [x1, y1, x2, y2].",
    source: "Library/Tools/New Tools/straight_skeleton_with_math.json",
    example: "E = Algorithms.Straight_skeleton(P, 0.002)",
    // The wavefront as a WORK LIST — one flat matrix W of [x, y, componentId] rows — advanced one EVENT per
    // loop pass: an edge COLLAPSE at t = −|E| / ((v' − v)·Ê), or a reflex vertex SPLIT at t = −d₀ / (v·n̂ − 1)
    // found by an argmin over the whole i×j vertex/edge table read as a linear index. Vertices travel along
    // the miter vector (Np + Nm) / (1 + Np·Nm) — the SAME formula as Algorithms.Inset, which is why offsetting
    // and skeletonisation are one piece of mathematics seen from two ends. Three sanitisers run first
    // (coincident merge, fold-back spike, pinch), because rectilinear plans collapse with exactly simultaneous
    // events; every emitted arc is then sampled at its quarter, half and three-quarter points and kept only if
    // all three lie inside the outline. The final line composes the two guarded endpoint lists into one
    // segment list, since a call returns one value.
    body: [
      "n0 = rows(P)",
      "_sa = sum(col(P,0) * col(shift(P,-1),1) - col(shift(P,-1),0) * col(P,1))",
      "s0 = _sa > 0 ? 1 : -1",
      "_BIG = 1e18",
      "_EPS = merge",
      "_EPT = 1e-9",
      "_VCAP = 50",
      "LIM = 6 * n0 + 8",
      "W = hcat(P, zeros(n0,1))",
      "EA = zeros(0,2)",
      "EB = zeros(0,2)",
      "_nid = 1",
      "loop it in LIM:",
      "  _p = min(col(W,2))",
      "  _sel = eq(col(W,2), _p)",
      "  _V0 = compress(sub(W,0,0,rows(W),2), _sel)",
      "  _REST = compress(W, 1 - _sel)",
      "  V = compress(_V0, ge(len(shift(_V0,-1) - _V0), _EPS))",
      "  m = rows(V)",
      "  _mm = max(m, 1)",
      "  _k = arange(m)",
      "  _Kr = T(_k)",
      "  _IDX = _k * m + _Kr",
      "  _VX = col(V,0)",
      "  _VY = col(V,1)",
      "  _Vn = shift(V,-1)",
      "  _Vp = shift(V,1)",
      "  Ed = _Vn - V",
      "  Le = len(Ed)",
      "  U = normalize(Ed)",
      "  Nm = perp(U) * s0",
      "  Np = shift(Nm,1)",
      "  vel = (Np + Nm) / (1 + dot(Np, Nm))",
      "  vel = vel * min(1, _VCAP / max(len(vel), 1e-12))",
      "  _velN = shift(vel,-1)",
      "  rate = dot(_velN - vel, U)",
      "  _tev = where(lt(rate, -1e-9), 0 - Le / rate, _BIG)",
      "  tE = min(_tev)",
      "  _ie = min(where(le(_tev, tE), _k, _BIG))",
      "  _d1 = V - _Vp",
      "  _d2 = _Vn - V",
      "  _crs = cross(_d1, _d2)",
      "  rfx = lt(_crs * s0, 0)",
      "  _cs = dot(normalize(_d1), normalize(_d2))",
      "  _spk = lt(_cs, -0.999)",
      "  _nsp = sum(_spk)",
      "  _is = min(where(_spk, _k, _BIG))",
      "  _vis = row(V, _is)",
      "  _qp = row(V, (_is - 1 + m) % _mm)",
      "  _qn = row(V, (_is + 1) % _mm)",
      "  _qq = len(_vis - _qp) <= len(_vis - _qn) ? _qp : _qn",
      "  _Vk = compress(V, 1 - eq(_k, _is))",
      "  _AX = T(_VX)",
      "  _AY = T(_VY)",
      "  _BX = T(col(_Vn,0))",
      "  _BY = T(col(_Vn,1))",
      "  _NX = T(col(Nm,0))",
      "  _NY = T(col(Nm,1))",
      "  _WX = col(vel,0)",
      "  _WY = col(vel,1)",
      "  _UX = T(_WX)",
      "  _UY = T(_WY)",
      "  _ZX = T(col(_velN,0))",
      "  _ZY = T(col(_velN,1))",
      "  _d0 = (_VX - _AX) * _NX + (_VY - _AY) * _NY",
      "  _rt = _WX * _NX + _WY * _NY - 1",
      "  _tsp = 0 - _d0 / _rt",
      "  _hx = _VX + _WX * _tsp",
      "  _hy = _VY + _WY * _tsp",
      "  _ax = _AX + _UX * _tsp",
      "  _ay = _AY + _UY * _tsp",
      "  _bx = _BX + _ZX * _tsp",
      "  _by = _BY + _ZY * _tsp",
      "  _ex = _bx - _ax",
      "  _ey = _by - _ay",
      "  _el2 = _ex * _ex + _ey * _ey",
      "  _sq = ((_hx - _ax) * _ex + (_hy - _ay) * _ey) / _el2",
      "  _exc = min(eq(_Kr, _k) + eq(_Kr, (_k - 1 + m) % _mm), 1)",
      "  _okS = rfx * ge(_tsp, 0) * gt(abs(_rt), 1e-6) * gt(_el2, 1e-12) * ge(_sq, -0.02) * le(_sq, 1.02) * (1 - _exc)",
      "  _tsv = where(_okS, _tsp, _BIG)",
      "  tS = min(_tsv)",
      "  _lin = min(where(le(_tsv, tS), _IDX, _BIG))",
      "  _ri = floor(_lin / _mm)",
      "  _ji = _lin - _ri * _mm",
      "  _DX = _VX - _AX",
      "  _DY = _VY - _AY",
      "  _D2 = _DX * _DX + _DY * _DY",
      "  _adj = min(eq(_Kr, _k) + eq(_Kr, (_k + 1) % _mm) + eq(_Kr, (_k - 1 + m) % _mm), 1)",
      "  _pk = le(_D2, _EPS * _EPS) * (1 - _adj) * lt(_k, _Kr)",
      "  _npn = sum(_pk)",
      "  _lp = min(where(_pk, _IDX, _BIG))",
      "  _pi = floor(_lp / _mm)",
      "  _pj = _lp - _pi * _mm",
      "  dead = m < 3 ? 1 : 0",
      "  spi = (1 - dead) * (_nsp > 0 ? 1 : 0)",
      "  pin = (1 - dead) * (1 - spi) * (_npn > 0 ? 1 : 0)",
      "  tEv = min(tE, tS)",
      "  _hasE = tEv < 1e17 ? 1 : 0",
      "  _doE = (1 - dead) * (1 - spi) * (1 - pin) * _hasE",
      "  spl = _doE * (tS < tE ? 1 : 0)",
      "  cls = dead + (1 - dead) * (1 - spi) * (1 - pin) * (1 - _hasE)",
      "  V2 = V + vel * tEv",
      "  _i2 = (_ie + 1) % _mm",
      "  _mid = (row(V2, _ie) + row(V2, _i2)) / 2",
      "  _Vm = where(eq(_k, _ie), _mid, V2)",
      "  _Ve = compress(_Vm, 1 - eq(_k, _i2))",
      "  _hit = row(V2, _ri)",
      "  _jj = (_ji - _ri + m) % _mm",
      "  _Vr = shift(V2, 0 - _ri)",
      "  _CA = vcat(sub(_Vr, 1, 0, _jj, 2), _hit)",
      "  _CB = vcat(sub(_Vr, _jj + 1, 0, m - 1 - _jj, 2), _hit)",
      "  _pmid = (row(V, _pi) + row(V, _pj)) / 2",
      "  _j2 = (_pj - _pi + m) % _mm",
      "  _Vq = shift(V, 0 - _pi)",
      "  _PA = vcat(sub(_Vq, 1, 0, _j2 - 1, 2), _pmid)",
      "  _PB = vcat(sub(_Vq, _j2 + 1, 0, m - 1 - _j2, 2), _pmid)",
      "  _cen = mean(V, 'cols')",
      "  _SA = _doE + cls > 0 ? V : (spi > 0 ? _vis : zeros(0,2))",
      "  _SB = _doE > 0 ? V2 : (cls > 0 ? V * 0 + _cen : (spi > 0 ? _qq : zeros(0,2)))",
      "  _kpE = gt(len(_SB - _SA), _EPT)",
      "  EA = vcat(EA, compress(_SA, _kpE))",
      "  EB = vcat(EB, compress(_SB, _kpE))",
      "  _Wk = vcat(_REST, hcat(_Vk, fill(rows(_Vk),1,_p)))",
      "  _Wp = vcat(vcat(_REST, hcat(_PA, fill(rows(_PA),1,_p))), hcat(_PB, fill(rows(_PB),1,_nid)))",
      "  _Ws = vcat(vcat(_REST, hcat(_CA, fill(rows(_CA),1,_p))), hcat(_CB, fill(rows(_CB),1,_nid)))",
      "  _Wg = vcat(_REST, hcat(_Ve, fill(rows(_Ve),1,_p)))",
      "  W = cls > 0 ? _REST : (spi > 0 ? _Wk : (pin > 0 ? _Wp : (spl > 0 ? _Ws : _Wg)))",
      "  _nid = pin + spl > 0 ? _nid + 1 : _nid",
      "end",
      "_ns = rows(EA)",
      "_SM = vcat(vcat(EA + (EB - EA) * 0.25, (EA + EB) / 2), EA + (EB - EA) * 0.75)",
      "_MX = col(_SM,0)",
      "_MY = col(_SM,1)",
      "_GX = T(col(P,0))",
      "_GY = T(col(P,1))",
      "_HX = T(col(shift(P,-1),0))",
      "_HY = T(col(shift(P,-1),1))",
      "_cr1 = ne(gt(_GY, _MY), gt(_HY, _MY))",
      "_xin = _GX + (_HX - _GX) * (_MY - _GY) / (_HY - _GY)",
      "_ins = sum(_cr1 * lt(_MX, _xin), 'rows') % 2",
      "_bex = _HX - _GX",
      "_bey = _HY - _GY",
      "_bt = min(1, max((_MX - _GX) * _bex + (_MY - _GY) * _bey, 0) / (_bex * _bex + _bey * _bey))",
      "_bdx = _MX - _GX - _bt * _bex",
      "_bdy = _MY - _GY - _bt * _bey",
      "_bd = min(_bdx * _bdx + _bdy * _bdy, 'rows')",
      "_ok = min(_ins + le(_bd, _EPS * _EPS), 1)",
      "keep = sub(_ok,0,0,_ns,1) * sub(_ok,_ns,0,_ns,1) * sub(_ok,2*_ns,0,_ns,1)",
      "QA = compress(EA, keep)",
      "QB = compress(EB, keep)",
      "E = hcat(QA, QB)"
    ].join("\n")
  },
  {
    qualified: "Algorithms.Optimise_rectangle",
    params: [
      { name: "P", about: "Outline as an N\xD72 point matrix" },
      { name: "lock", about: "Lock the rectangle's axis to this angle in DEGREES. 0 (the default) sweeps every angle; use 180 for axis-aligned, which is ~6\xD7 faster", optional: true },
      { name: "step", about: "Sweep step in degrees, default 30. Halve it for a better angle, at double the cost", optional: true },
      { name: "res", about: "Grid cells across the longer axis, default 32. Cost grows as res\xB3", optional: true }
    ],
    returns: "R",
    summary: "Largest rectangle that fits inside an outline, at the best angle. Returns its 4 corners.",
    source: "src/floorplan/algorithms/layout/optimiseRect.ts (largestInscribedRectangle)",
    example: "R = Algorithms.Optimise_rectangle(P, 180)",
    // The TS construction, re-expressed: rotate the outline into each candidate axis, rasterise it, and take
    // the largest all-ones block. Two things make it affordable here, where a per-cell loop would not be.
    //
    // THE INSIDE TEST IS TWO PIP PASSES, NOT FIVE. The TS tests each cell's centre AND its four inset
    // corners — five point-in-polygon tests per cell. But adjacent cells SHARE corners, so one pass over the
    // (H+1)×(W+1) corner LATTICE plus one over the H×W centres covers the same five points for every cell at
    // once; `sub(_L,…)` reads the four corners of every cell as four overlapping slices of one matrix. Each
    // pass is the ray-crossing parity of the whole grid against one edge, accumulated by `abs(_IN - cross)`
    // — XOR, because a matrix has no boolean type.
    //
    // THE LARGEST ALL-ONES BLOCK IS A RUNNING MINIMUM, NOT A STACK. The TS uses a monotonic stack per row,
    // which is sequential and inexpressible. Instead `_UP` is each column's run of ones ending at that row
    // (H passes of `_G * (shift(_UP,1) + 1)`, the row-0 wrap masked off), and then ONE loop over WIDTH turns
    // the whole search into W matrix operations: `min(_mw, shift(_UP, -w, 'cols'))` is, for every cell at
    // once, the shortest column in the w-wide window starting there — which IS the tallest rectangle of that
    // width anchored there. The argmax over the resulting i×j table is read as a linear index and split by
    // floor / remainder, the documented idiom. Cost is O(angles · res³) matrix cells, which is why `res`
    // defaults to 32 rather than the TS's 150 — see the summary for what that costs in accuracy.
    body: [
      "# Setup",
      "_rs = res > 0 ? res : 32",
      "_st = step > 0 ? step : 30",
      "_na = lock > 0 ? 1 : ceil(180 / _st)",
      "_x0 = min(col(P,0))",
      "_x1 = max(col(P,0))",
      "_y0 = min(col(P,1))",
      "_y1 = max(col(P,1))",
      "_cx = (_x0 + _x1) / 2",
      "_cy = (_y0 + _y1) / 2",
      "_np = rows(P)",
      "_bA = 0 - 1",
      "_bR = zeros(4,2)",
      "# Angle sweep",
      "loop a in _na:",
      "  _th = lock > 0 ? lock * PI / 180 : a * _st * PI / 180",
      "  _co = cos(0 - _th)",
      "  _si = sin(0 - _th)",
      "  _PX = (col(P,0) - _cx) * _co - (col(P,1) - _cy) * _si + _cx",
      "  _PY = (col(P,0) - _cx) * _si + (col(P,1) - _cy) * _co + _cy",
      "  _rx = min(_PX)",
      "  _ry = min(_PY)",
      "  _cs = max(max(max(_PX) - _rx, max(_PY) - _ry) / _rs, 1e-9)",
      "  _W = max(1, ceil((max(_PX) - _rx) / _cs))",
      "  _H = max(1, ceil((max(_PY) - _ry) / _cs))",
      "# Inside test \u2014 one pip pass on the corner LATTICE, one on the cell CENTRES",
      "  _LX = _rx + ones(_H+1,1) @ T(arange(_W+1)) * _cs",
      "  _LY = _ry + arange(_H+1) @ ones(1,_W+1) * _cs",
      "  _CI = ones(_H,1) @ T(arange(_W))",
      "  _RI = arange(_H) @ ones(1,_W)",
      "  _XC = _rx + (_CI + 0.5) * _cs",
      "  _YC = _ry + (_RI + 0.5) * _cs",
      "  _L = zeros(_H+1, _W+1)",
      "  _C = zeros(_H, _W)",
      "  loop e in _np:",
      "    _ea = row(_PX, e)",
      "    _fa = row(_PY, e)",
      "    _eb = row(_PX, (e + 1) % _np)",
      "    _fb = row(_PY, (e + 1) % _np)",
      "    _dv = _fb - _fa == 0 ? 1e-9 : _fb - _fa",
      "    _L = abs(_L - ne(gt(_fa, _LY), gt(_fb, _LY)) * lt(_LX, _ea + (_eb - _ea) * (_LY - _fa) / _dv))",
      "    _C = abs(_C - ne(gt(_fa, _YC), gt(_fb, _YC)) * lt(_XC, _ea + (_eb - _ea) * (_YC - _fa) / _dv))",
      "  end",
      "  _G = _C * sub(_L,0,0,_H,_W) * sub(_L,0,1,_H,_W) * sub(_L,1,0,_H,_W) * sub(_L,1,1,_H,_W)",
      "# Largest all-ones block \u2014 column runs, then a running minimum across widths",
      "  _UP = _G",
      "  loop u in _H:",
      "    _UP = _G * (shift(_UP,1) * gt(_RI,0) + 1)",
      "  end",
      "  _IX = _RI * _W + _CI",
      "  _mw = _UP",
      "  _aA = 0",
      "  _aW = 1",
      "  _aL = 0",
      "  loop w in _W:",
      "    _mw = min(_mw, shift(_UP, 0 - w, 'cols'))",
      "    _ar = (w + 1) * _mw * le(_CI + w + 1, _W)",
      "    _mx = max(_ar)",
      "    _aW = _mx > _aA ? w + 1 : _aW",
      "    _aL = _mx > _aA ? min(where(ge(_ar, _mx), _IX, 1e18)) : _aL",
      "    _aA = max(_aA, _mx)",
      "  end",
      "# Winning block \u2192 metres, corners rotated back to world",
      "  _j = floor(_aL / _W)",
      "  _i = _aL - _j * _W",
      "  _sf = 0.05 * _cs",
      "  _gx0 = _rx + _i * _cs + _sf",
      "  _gy0 = _ry + (_j - _aA / _aW + 1) * _cs + _sf",
      "  _gx1 = _rx + (_i + _aW) * _cs - _sf",
      "  _gy1 = _ry + (_j + 1) * _cs - _sf",
      "  _ra = _aA > 0 && _gx1 > _gx0 && _gy1 > _gy0 ? (_gx1 - _gx0) * (_gy1 - _gy0) : 0",
      "  _RL = vcat(vcat(vcat(hcat(_gx0,_gy0), hcat(_gx1,_gy0)), hcat(_gx1,_gy1)), hcat(_gx0,_gy1))",
      "  _cb = cos(_th)",
      "  _sb = sin(_th)",
      "  _RW = hcat((col(_RL,0) - _cx) * _cb - (col(_RL,1) - _cy) * _sb + _cx, (col(_RL,0) - _cx) * _sb + (col(_RL,1) - _cy) * _cb + _cy)",
      "  _bR = _ra > _bA ? _RW : _bR",
      "  _bA = max(_bA, _ra)",
      "end",
      "R = _bR"
    ].join("\n")
  }
];
var EXPR_ALGORITHM_BY_NAME = Object.fromEntries(
  EXPR_ALGORITHMS.map((a) => [a.qualified.toLowerCase(), a])
);

// ../engine/src/expr/expr.ts
var isM = (v) => Array.isArray(v);
var asM = (v) => parseMatrixOrScalar(v);
var toNum = (x) => typeof x === "number" ? x : typeof x === "boolean" ? x ? 1 : 0 : isM(x) ? x[0]?.[0] ?? 0 : parseFloat(x) || 0;
var truthy = (x) => typeof x === "boolean" ? x : typeof x === "number" ? x !== 0 : isM(x) ? x.length > 0 : x !== "";
var eq = (a, b) => {
  if (a === b) return true;
  if (isM(a) || isM(b)) return JSON.stringify(a) === JSON.stringify(b);
  const na = Number(a), nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
};
var SCALAR_FUNCS = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sqrt: Math.sqrt,
  // Trig (radians) + pow — for rotated leaves, swing arcs, etc. `PI` is injected into the scope as a value.
  cos: Math.cos,
  sin: Math.sin,
  tan: Math.tan,
  atan2: Math.atan2,
  pow: Math.pow,
  // −1 / 0 / +1. Lifts element-wise like the rest, which is what makes an ORIENTATION test vectorisable:
  // a segment-intersection predicate is four orientation signs compared against each other.
  sign: Math.sign,
  // Logs and exp. `^` covers powers, but nothing inverted one, so every ratio-to-interval conversion was out
  // of reach: semitones from a frequency (12·log2(f/440)), decibels, a Richter or pH value, the exponential
  // decay in a daylight or heat-loss curve. `log` is natural; guard ≤0 to 0 rather than −Infinity so one bad
  // cell cannot poison a whole broadcast column.
  log: (x) => x > 0 ? Math.log(x) : 0,
  log2: (x) => x > 0 ? Math.log2(x) : 0,
  log10: (x) => x > 0 ? Math.log10(x) : 0,
  exp: Math.exp
};
var reduceFn = (op) => (a) => {
  const axis = typeof a[1] === "string" ? a[1] : "all";
  const R = reduceMatrix(asM(a[0]), op, axis);
  return axis === "all" ? R[0]?.[0] ?? 0 : R;
};
var minmax = (op) => (a) => {
  const f = op === "min" ? Math.min : Math.max;
  if (typeof a[1] === "string") return reduceFn(op)(a);
  if (a.length === 1 && isM(a[0])) return reduceFn(op)(a);
  if (a.length === 2 && a.some(isM)) return elementwiseMatrix(asM(a[0]), asM(a[1]), f) ?? [];
  return f(...a.map(toNum));
};
var cmpFn = (f) => (a) => elementwiseMatrix(asM(a[0]), asM(a[1]), (x, y) => f(x, y) ? 1 : 0) ?? [];
var foldCat = (a, f) => {
  if (!a.length) return [];
  let acc = asM(a[0]);
  for (let i = 1; i < a.length; i++) {
    const next = f(acc, asM(a[i]));
    if (!next) return [];
    acc = next;
  }
  return acc;
};
var MATRIX_FUNCS = {
  // — shape / algebra —
  T: (a) => transposeMatrix(asM(a[0])),
  inv: (a) => invertMatrix(asM(a[0])) ?? [],
  solve: (a) => solveMatrix(asM(a[0]), asM(a[1])) ?? [],
  kron: (a) => kronMatrix(asM(a[0]), asM(a[1])) ?? [],
  rows: (a) => asM(a[0]).length,
  cols: (a) => asM(a[0])[0]?.length ?? 0,
  // — row-wise vector maths (an N×2 matrix IS a list of N 2D vectors) —
  // A third argument picks the axis: the default "rows" rolls the row ORDER (the neighbour list); "cols"
  // rolls ALONG each row, so a sorted row minus its own shift is that row's gap list.
  shift: (a) => shiftMatrix(asM(a[0]), toNum(a[1] ?? 0), typeof a[2] === "string" ? a[2] : "rows"),
  normalize: (a) => vectorOpMatrix(asM(a[0]), "normalize"),
  perp: (a) => vectorOpMatrix(asM(a[0]), "perp"),
  perpcw: (a) => vectorOpMatrix(asM(a[0]), "perp-cw"),
  len: (a) => vectorOpMatrix(asM(a[0]), "length"),
  dot: (a) => vectorProductMatrix(asM(a[0]), asM(a[1]), "dot"),
  cross: (a) => vectorProductMatrix(asM(a[0]), asM(a[1]), "cross"),
  // One argument = the direction of each row; two = the SIGNED angle between two vector lists.
  angle: (a) => a.length >= 2 ? vectorProductMatrix(asM(a[0]), asM(a[1]), "angle") : vectorOpMatrix(asM(a[0]), "angle"),
  // — reductions —
  sum: reduceFn("sum"),
  mean: reduceFn("mean"),
  prod: reduceFn("product"),
  min: minmax("min"),
  max: minmax("max"),
  // — constructors: a matrix of a WIRED size, which no node can produce —
  eye: (a) => eyeMatrix(toNum(a[0])),
  zeros: (a) => fillMatrix(toNum(a[0]), a.length > 1 ? toNum(a[1]) : 1, 0),
  ones: (a) => fillMatrix(toNum(a[0]), a.length > 1 ? toNum(a[1]) : 1, 1),
  fill: (a) => fillMatrix(toNum(a[0]), toNum(a[1]), toNum(a[2])),
  arange: (a) => a.length > 1 ? arangeMatrix(toNum(a[0]), toNum(a[1])) : arangeMatrix(toNum(a[0])),
  diag: (a) => diagMatrix(asM(a[0])),
  // — order / selection: the two things that change a point list's ORDER and its LENGTH —
  // `sort` orders the values INSIDE each row (or column); `sortby` permutes the ROWS by a key column, so a
  // whole point travels with its key — `sortby(P, angle(P - c))` is the CCW ring of a cloud, and
  // `sortby(P, 0)` the lexicographic-by-x sweep. `compress` drops the rows whose mask cell is 0, which is
  // the first operation here whose OUTPUT ROW COUNT is data — the convex hull's "keep only the extreme
  // points". `where` is the element-wise ternary (a masked substitution) the operators can't express,
  // since `?:` tests a whole matrix's [0][0] cell rather than going cell by cell.
  sort: (a) => sortMatrix(asM(a[0]), typeof a[1] === "string" ? a[1] : "rows"),
  sortby: (a) => sortByMatrix(asM(a[0]), isM(a[1]) ? a[1] : subMatrix(asM(a[0]), 0, toNum(a[1]), asM(a[0]).length, 1)),
  compress: (a) => compressMatrix(asM(a[0]), asM(a[1])),
  where: (a) => selectMatrix(asM(a[0]), asM(a[1]), asM(a[2])) ?? [],
  gt: cmpFn((x, y) => x > y),
  lt: cmpFn((x, y) => x < y),
  ge: cmpFn((x, y) => x >= y),
  le: cmpFn((x, y) => x <= y),
  // `eq` / `ne` are the mask forms of == / != . The OPERATORS keep their scalar meaning (and `==` also
  // compares strings, which a mask cannot); these compare cell by cell, so an INDEX can be tested against a
  // whole row/column of indices — `eq(K, i)` is how "skip the edges incident to vertex i" becomes a matrix.
  eq: cmpFn((x, y) => x === y),
  ne: cmpFn((x, y) => x !== y),
  // — slice / concat: indexing by a CONSTANT. Indexing by a COMPUTED value stays out of reach. —
  sub: (a) => subMatrix(asM(a[0]), toNum(a[1]), toNum(a[2]), toNum(a[3]), toNum(a[4])),
  row: (a) => subMatrix(asM(a[0]), toNum(a[1]), 0, 1, asM(a[0])[0]?.length ?? 0),
  col: (a) => subMatrix(asM(a[0]), 0, toNum(a[1]), asM(a[0]).length, 1),
  // VARIADIC — `hcat(a, b, c, …)` / `vcat(a, b, c, …)`; see {@link foldCat}.
  hcat: (a) => foldCat(a, hcatMatrix),
  vcat: (a) => foldCat(a, vcatMatrix),
  reshape: (a) => reshapeMatrix(asM(a[0]), toNum(a[1]), toNum(a[2])),
  // — BOOLEANS: the operations that REMOVE material, which no amount of construction can express —
  // 2D, on the grouped ring list a Polygon row reads (even-odd in, group column out, so holes survive).
  // These retire this node's own long-standing "polygon booleans are not possible here" caveat: what was
  // impossible was a hand-rolled clipper, not a boolean — the project already ships a sweep-line one.
  subtract: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "subtract"),
  union: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "union"),
  intersect: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "intersect"),
  xor: (a) => boolMatrix2d(asM(a[0]), asM(a[1]), "xor"),
  // Point-in-shape as a MASK — the trimming counterpart, and how a surface grid loses the quads that fall
  // inside a cutter without a mesh boolean at all.
  inpoly: (a) => inPolyMask(asM(a[0]), asM(a[1])),
  // 3D, on the `[x,y,z,f]` face list a Polyhedron row reads. BSP CSG, in-house because the project's mesh
  // boolean is bound to THREE and this module must stay a leaf.
  msubtract: (a) => boolMatrix3d(asM(a[0]), asM(a[1]), "subtract"),
  munion: (a) => boolMatrix3d(asM(a[0]), asM(a[1]), "union"),
  mintersect: (a) => boolMatrix3d(asM(a[0]), asM(a[1]), "intersect"),
  // …and the solids to operate on, which the engine could not previously make: a drill and an extrusion.
  mcyl: (a) => cylMatrix(asM(a[0]), toNum(a[1]), a.length > 2 ? toNum(a[2]) : 12, a.length > 3 ? toNum(a[3]) : void 0),
  mprism: (a) => prismMatrix(asM(a[0]), toNum(a[1]), toNum(a[2])),
  // A hollow body is a PROFILE, never a subtraction: `msubtract(cyl, longer cyl)` is a poor case for BSP
  // (thin walls straddle the bore's radial planes instead of sitting behind them) and measures 3.5–4.5× the
  // faces of a revolve for the same tube. Leaves the boolean for what only it can do — the holes.
  mlathe: (a) => latheMatrix(asM(a[0]), asM(a[1]), a.length > 2 ? toNum(a[2]) : 24),
  // — CURVES: the shapes that could only be approached by hand-written column arithmetic —
  // Each of these is writable in this language already; none is writable in four lines at the general
  // degree, and a scalar loop over 200 samples costs thousands of interpreter steps to say the same
  // thing. See curves.ts for why they are builtins rather than Algorithms entries.
  bezier: (a) => bezierMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 32),
  bspline: (a) => bsplineMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 3, a.length > 2 ? toNum(a[2]) : 64),
  nurbs: (a) => nurbsMatrix(asM(a[0]), asM(a[1]), a.length > 2 ? toNum(a[2]) : 3, a.length > 3 ? toNum(a[3]) : 64),
  catenary: (a) => catenaryMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 1, a.length > 2 ? toNum(a[2]) : 32),
  // The measuring tape and the even-spacing conversion — a curve evaluator samples in the PARAMETER,
  // and anything placed along the result (treads, balusters, panel joints) needs spacing in the WORLD.
  arclen: (a) => arclenMatrix(asM(a[0])),
  resample: (a) => resampleMatrix(asM(a[0]), a.length > 1 ? toNum(a[1]) : 32),
  // — SOLIDS the constructors above could not reach: a real geodesic frequency, and a profile carried
  // along a curved path.
  geodesic: (a) => geodesicMatrix(toNum(a[0]), a.length > 1 ? toNum(a[1]) : 1, a.length > 2 ? toNum(a[2]) : 0, a.length > 3 ? asM(a[3]) : void 0),
  msweep: (a) => sweepMatrix(asM(a[0]), asM(a[1]), a.length > 2 ? toNum(a[2]) : 0)
};
var algoDepth = 0;
var MAX_ALGO_DEPTH = 8;
var callAlgorithm = (name, args) => {
  const algo = EXPR_ALGORITHM_BY_NAME[name.toLowerCase()];
  if (!algo) return void 0;
  if (algoDepth >= MAX_ALGO_DEPTH) return 0;
  const scope = { PI: Math.PI };
  algo.params.forEach((p, i) => {
    scope[p.name] = args[i] ?? 0;
  });
  algoDepth++;
  try {
    return runExprBody(algo.body, scope)[algo.returns] ?? 0;
  } finally {
    algoDepth--;
  }
};
var callFn = (nameIn, args) => {
  if (nameIn.includes(".")) {
    const algo = callAlgorithm(nameIn, args);
    if (algo !== void 0) return algo;
  }
  const name = nameIn.includes(".") ? EXPR_ALIASES[nameIn.toLowerCase()] ?? nameIn : nameIn;
  const mf = MATRIX_FUNCS[name];
  if (mf) return mf(args);
  const sf = SCALAR_FUNCS[name];
  if (!sf) return 0;
  if (args.some(isM)) {
    if (args.length === 1) return asM(args[0]).map((r) => r.map((x) => round6(sf(x))));
    if (args.length === 2) return elementwiseMatrix(asM(args[0]), asM(args[1]), (x, y) => sf(x, y)) ?? [];
  }
  return sf(...args.map(toNum));
};
var binOp = (op, a, b) => {
  if (op === "@") return multiplyMatrix(asM(a), asM(b)) ?? [];
  if ((isM(a) || isM(b)) && ELEMENTWISE[op]) return elementwiseMatrix(asM(a), asM(b), ELEMENTWISE[op]) ?? [];
  switch (op) {
    case "*":
      return toNum(a) * toNum(b);
    case "/":
      return toNum(a) / toNum(b);
    case "%":
      return toNum(a) % toNum(b);
    case "^":
      return Math.pow(toNum(a), toNum(b));
    case "+":
      return toNum(a) + toNum(b);
    case "-":
      return toNum(a) - toNum(b);
    case "<":
      return toNum(a) < toNum(b);
    case "<=":
      return toNum(a) <= toNum(b);
    case ">":
      return toNum(a) > toNum(b);
    case ">=":
      return toNum(a) >= toNum(b);
    case "==":
      return eq(a, b);
    case "!=":
      return !eq(a, b);
    default:
      return 0;
  }
};
var tokenize = (src) => {
  const toks = [];
  const two = /* @__PURE__ */ new Set(["==", "!=", "<=", ">=", "&&", "||"]);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "	" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) {
        s += src[j];
        j++;
      }
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(src[i + 1] ?? "")) {
      let j = i, s = "";
      while (j < src.length && /[0-9.]/.test(src[j])) {
        s += src[j];
        j++;
      }
      const e = src[j];
      if (e === "e" || e === "E") {
        let k = j + 1;
        if (src[k] === "+" || src[k] === "-") k++;
        if (/[0-9]/.test(src[k] ?? "")) {
          s += src.slice(j, k);
          while (k < src.length && /[0-9]/.test(src[k])) {
            s += src[k];
            k++;
          }
          j = k;
        }
      }
      toks.push({ t: "num", v: s });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i, s = "";
      while (j < src.length) {
        if (/[A-Za-z0-9_]/.test(src[j])) {
          s += src[j];
          j++;
          continue;
        }
        if (src[j] === "." && /[A-Za-z_]/.test(src[j + 1] ?? "")) {
          s += ".";
          j++;
          continue;
        }
        break;
      }
      toks.push({ t: "id", v: s });
      i = j;
      continue;
    }
    const pair = src.slice(i, i + 2);
    if (two.has(pair)) {
      toks.push({ t: "op", v: pair });
      i += 2;
      continue;
    }
    toks.push({ t: "op", v: c });
    i++;
  }
  return toks;
};
var parse = (toks) => {
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (v) => {
    const t = toks[pos];
    if (v && (!t || t.v !== v)) throw new Error(`expected ${v}`);
    pos++;
    return t;
  };
  const binL = (next, ops) => {
    let left = next();
    while (peek() && ops.includes(peek().v)) {
      const op = eat().v;
      const right = next();
      const l = left;
      left = (sc) => binOp(op, l(sc), right(sc));
    }
    return left;
  };
  function primary() {
    const t = peek();
    if (!t) throw new Error("unexpected end");
    if (t.v === "(") {
      eat("(");
      const e = ternary();
      eat(")");
      return e;
    }
    if (t.v === "-") {
      eat("-");
      const e = pow();
      return (sc) => {
        const v = e(sc);
        return isM(v) ? vectorOpMatrix(v, "negate") : -toNum(v);
      };
    }
    if (t.v === "!") {
      eat("!");
      const e = primary();
      return (sc) => !truthy(e(sc));
    }
    if (t.t === "num") {
      eat();
      const n = parseFloat(t.v);
      return () => n;
    }
    if (t.t === "str") {
      eat();
      const s = t.v;
      return () => s;
    }
    if (t.t === "id") {
      eat();
      if (peek()?.v === "(") {
        eat("(");
        const args = [];
        if (peek()?.v !== ")") {
          args.push(ternary());
          while (peek()?.v === ",") {
            eat(",");
            args.push(ternary());
          }
        }
        eat(")");
        const name2 = t.v;
        return (sc) => callFn(name2, args.map((a) => a(sc)));
      }
      const name = t.v;
      return (sc) => name in sc ? sc[name] : 0;
    }
    throw new Error(`unexpected ${t.v}`);
  }
  function pow() {
    const l = primary();
    if (peek()?.v === "^") {
      eat("^");
      const r = pow();
      return (sc) => binOp("^", l(sc), r(sc));
    }
    return l;
  }
  const mul = () => binL(pow, ["*", "/", "%", "@"]);
  const add = () => binL(mul, ["+", "-"]);
  const cmp = () => binL(add, ["<", "<=", ">", ">="]);
  const equ = () => binL(cmp, ["==", "!="]);
  const and = () => {
    let l = equ();
    while (peek()?.v === "&&") {
      eat();
      const r = equ();
      const a = l;
      l = (sc) => truthy(a(sc)) && truthy(r(sc));
    }
    return l;
  };
  const or = () => {
    let l = and();
    while (peek()?.v === "||") {
      eat();
      const r = and();
      const a = l;
      l = (sc) => truthy(a(sc)) || truthy(r(sc));
    }
    return l;
  };
  function ternary() {
    const c = or();
    if (peek()?.v === "?") {
      eat("?");
      const a = ternary();
      eat(":");
      const b = ternary();
      return (sc) => truthy(c(sc)) ? a(sc) : b(sc);
    }
    return c;
  }
  return ternary();
};
var astCache = /* @__PURE__ */ new Map();
var compile = (expr) => {
  let n = astCache.get(expr);
  if (!n) {
    n = parse(tokenize(expr));
    astCache.set(expr, n);
  }
  return n;
};
var DEF = /^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$/;
var LOOP = /^loop\s+([A-Za-z_]\w*)\s+in\s+(.+?)\s*:?\s*$/i;
var END = /^end$/i;
var MAX_LOOP_COUNT = 1e4;
var MAX_STEPS = 2e5;
var parseExprStmts = (src) => {
  const body = typeof src === "string" ? src : "";
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const root = [];
  const stack = [root];
  for (const line of lines) {
    const cur = stack[stack.length - 1];
    const lm = LOOP.exec(line);
    if (lm) {
      const stmt = { kind: "loop", name: lm[1], count: lm[2].trim(), body: [] };
      cur.push(stmt);
      stack.push(stmt.body);
      continue;
    }
    if (END.test(line)) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const m = DEF.exec(line);
    if (m) cur.push({ kind: "def", name: m[1], expr: m[2].trim() });
  }
  return root;
};
var isInternal = (name) => name.charCodeAt(0) === 95;
var flattenStmts = (stmts, out) => {
  for (const s of stmts) {
    if (s.kind === "def") out.push({ name: s.name, expr: s.expr });
    else flattenStmts(s.body, out);
  }
};
var parseExprDefs = (src) => {
  const defs = [];
  flattenStmts(parseExprStmts(src), defs);
  if (defs.length) return defs;
  const lines = (typeof src === "string" ? src : "").split("\n").map((l) => l.trim()).filter(Boolean);
  return [{ name: "result", expr: lines.join(" ") }];
};
var runExprBody = (src, scope) => {
  const stmts = parseExprStmts(src);
  const out = {};
  const declared = [];
  flattenStmts(stmts, declared);
  if (!declared.length) {
    const raw = evalValue(parseExprDefs(src)[0].expr, scope);
    scope.result = raw;
    return { result: raw };
  }
  for (const d of declared) if (!isInternal(d.name)) out[d.name] = 0;
  let steps = 0;
  const run = (list) => {
    for (const s of list) {
      if (++steps > MAX_STEPS) return;
      if (s.kind === "def") {
        const raw2 = evalValue(s.expr, scope);
        scope[s.name] = raw2;
        if (!isInternal(s.name)) out[s.name] = raw2;
        continue;
      }
      const raw = toNum(evalValue(s.count, scope));
      const n = Math.min(MAX_LOOP_COUNT, Math.max(0, Math.floor(Number.isFinite(raw) ? raw : 0)));
      for (let k = 0; k < n; k++) {
        scope[s.name] = k;
        run(s.body);
        if (steps > MAX_STEPS) return;
      }
    }
  };
  run(stmts);
  return out;
};
var evalValue = (expr, sc) => {
  if (typeof expr === "number" || typeof expr === "boolean") return expr;
  if (typeof expr !== "string" || !expr.trim()) return 0;
  try {
    return compile(expr)(sc);
  } catch {
    return 0;
  }
};
var evalRaw = (expr, sc) => {
  const v = evalValue(expr, sc);
  return isM(v) ? JSON.stringify(v) : v;
};
var evalNum = (expr, sc) => toNum(evalRaw(expr, sc));
var evalTruthy = (expr, sc) => expr == null ? true : truthy(evalRaw(expr, sc));

// src/floorplan/flow/conditional.ts
var CONDITION_OP_OPTIONS = [
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "\u2265 at least" },
  { value: "eq", label: "= equals" },
  { value: "lte", label: "\u2264 at most" },
  { value: "lt", label: "< less than" },
  { value: "ne", label: "\u2260 not equal" }
];

// src/floorplan/flow/nodeDeclaration.ts
var buildScope = (params, vars) => {
  const sc = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") sc[k] = v;
    else if (v != null) sc[k] = String(v);
  }
  if (vars) for (const [k, expr] of Object.entries(vars)) sc[k] = evalRaw(expr, sc);
  return sc;
};
function buildToolDefFromDeclaration(decl) {
  const vars = decl.vars;
  const fields = decl.parameters.map((p) => {
    const field = { key: p.key, label: p.label, kind: p.kind };
    if (p.options) field.options = p.options;
    if (p.optionsFromParam) field.optionsFromParam = p.optionsFromParam;
    if (p.min != null) field.min = p.min;
    if (p.max != null) field.max = p.max;
    if (p.step != null) field.step = p.step;
    if (p.unit != null) field.unit = p.unit;
    if (p.placeholder != null) field.placeholder = p.placeholder;
    if (p.rows != null) field.rows = p.rows;
    if (p.sections) field.sections = true;
    if (p.secret) field.secret = true;
    if (p.output) field.output = true;
    if (p.role != null) field.role = p.role;
    if (p.showWhen) {
      const expr = p.showWhen;
      field.showIf = (params) => evalTruthy(expr, buildScope(params, vars));
    }
    return field;
  });
  const defaultParams = {};
  for (const p of decl.parameters) if (p.default !== void 0) defaultParams[p.key] = p.default;
  if (decl.defaults) Object.assign(defaultParams, decl.defaults);
  const h = decl.handles ?? {};
  const def = {
    type: decl.tool,
    label: decl.meta.label,
    color: decl.meta.color,
    hasInput: Boolean(h.input),
    hasOutput: Boolean(h.output),
    defaultParams,
    fields,
    hint: decl.description ?? ""
  };
  if (decl.instructions) def.instructions = decl.instructions;
  if (decl.materialisesSpace) def.materialisesSpace = true;
  if (decl.materialisesSegments) def.materialisesSegments = true;
  if (decl.materialisesSpaceEdges === false) def.materialisesSpaceEdges = false;
  if (h.outputCount) {
    const expr = h.outputCount;
    def.outputCount = (params) => Math.max(0, Math.round(evalNum(expr, buildScope(params, vars))));
  }
  if (h.outputLabels) def.outputLabels = h.outputLabels;
  if (h.valueOutputs) def.valueOutputs = h.valueOutputs;
  if (h.valueInputs) def.valueInputs = h.valueInputs;
  if (h.geomInputs) def.geomInputs = h.geomInputs;
  if (h.exposesParams) def.exposesParams = true;
  if (h.acceptsParams) def.acceptsParams = true;
  return def;
}

// src/floorplan/flow/declarations/optimise-rect.node.json
var optimise_rect_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "optimise-rect",
  meta: {
    label: "Optimise Rectangle",
    category: "Reshape",
    color: "#7c3aed"
  },
  description: "Pack optimal rectangles inside a polygon \u2014 a pure CALCULATION node: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the packed rectangles as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want them drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon.\n\nOUTPUT: val-polygons publishes every rectangle as a nested [[[x,y],...],...] list, which a Polygon node accepts directly. val-area still reports the total packed area (m2).\n\nPACKING: shape / count / gap / union / reference / axisAngle shape the result; optimiseAxisTilt auto-picks the tilt that maximises packed area. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "axisAngle",
        label: "Axis tilt"
      },
      {
        key: "count",
        label: "Rectangles (n)"
      },
      {
        key: "optimiseAxisTilt",
        label: "Optimise axis tilt"
      }
    ],
    valueOutputs: [
      {
        key: "area",
        label: "Area",
        unit: "m\xB2"
      },
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  vars: {
    isRect: "shape != 'lshape' && shape != 'tshape' && shape != 'zshape' && shape != 'ishape' && shape != 'cshape' && shape != 'stepped' && shape != 'cross'",
    isInscribed: "!isRect"
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "shape",
      label: "Shape",
      kind: "select",
      default: "rectangle",
      options: [
        {
          value: "rectangle",
          label: "Rectangle"
        },
        {
          value: "square",
          label: "Square"
        },
        {
          value: "hexagon",
          label: "Hexagon"
        },
        {
          value: "lshape",
          label: "L-shape (inscribed)"
        },
        {
          value: "tshape",
          label: "T-shape (inscribed)"
        },
        {
          value: "zshape",
          label: "Z-shape (inscribed)"
        },
        {
          value: "ishape",
          label: "I-shape (inscribed)"
        },
        {
          value: "cshape",
          label: "C-shape (inscribed)"
        },
        {
          value: "stepped",
          label: "Stepped (inscribed)"
        },
        {
          value: "cross",
          label: "Cross (inscribed)"
        }
      ]
    },
    {
      key: "random",
      label: "Random",
      kind: "checkbox",
      default: false
    },
    {
      key: "seed",
      label: "Seed",
      kind: "number",
      default: 1,
      min: 1,
      step: 1,
      showWhen: "random"
    },
    {
      key: "reference",
      label: "Reference",
      kind: "select",
      default: "none",
      options: [
        {
          value: "none",
          label: "None (any-angle)"
        },
        {
          value: "custom",
          label: "Custom angle"
        },
        {
          value: "by-edge",
          label: "By edge"
        }
      ],
      showWhen: "!random && isRect"
    },
    {
      key: "referenceEdge",
      label: "Edge index",
      kind: "range",
      default: 0,
      min: 0,
      max: 19,
      step: 1,
      showWhen: "!random && reference == 'by-edge' && isRect"
    },
    {
      key: "optimiseAxisTilt",
      label: "Optimise axis tilt",
      kind: "checkbox",
      default: false,
      showWhen: "!random && reference == 'custom' && isRect"
    },
    {
      key: "axisAngle",
      label: "Axis tilt",
      kind: "range",
      default: 0,
      min: 0,
      max: 180,
      step: 0.5,
      unit: "\xB0",
      showWhen: "!random && (isInscribed || (reference == 'custom' && !optimiseAxisTilt) || reference == 'by-edge')"
    },
    {
      key: "steps",
      label: "Steps",
      kind: "range",
      default: 3,
      min: 1,
      max: 10,
      step: 1,
      showWhen: "shape == 'stepped'"
    },
    {
      key: "minNotch",
      label: "Min notch length",
      kind: "range",
      default: 0,
      min: 0,
      max: 20,
      step: 0.1,
      unit: "m",
      showWhen: "isInscribed"
    },
    {
      key: "minThickness",
      label: "Min part thickness",
      kind: "range",
      default: 0,
      min: 0,
      max: 20,
      step: 0.1,
      unit: "m",
      showWhen: "isInscribed"
    },
    {
      key: "count",
      label: "Rectangles (n)",
      kind: "range",
      default: 1,
      min: 1,
      max: 20,
      step: 1,
      showWhen: "!random && isRect"
    },
    {
      key: "gap",
      label: "Gap",
      kind: "range",
      default: 0,
      min: 0,
      max: 20,
      step: 0.1,
      unit: "m",
      showWhen: "!random && count > 1 && isRect"
    },
    {
      key: "union",
      label: "Union",
      kind: "checkbox",
      default: false,
      showWhen: "!random && count > 1 && isRect"
    },
    {
      key: "shrinkEnabled",
      label: "Shrink to target",
      kind: "checkbox",
      default: false,
      showWhen: "isRect"
    },
    {
      key: "targetArea",
      label: "Target area",
      kind: "range",
      default: 50,
      min: 0,
      max: 500,
      step: 0.5,
      unit: "m\xB2",
      showWhen: "shrinkEnabled && isRect"
    },
    {
      key: "shrinkAngle",
      label: "Shrink angle",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0",
      showWhen: "shrinkEnabled && isRect"
    },
    {
      key: "optimiseShrinkEnabled",
      label: "Optimise shrink",
      kind: "checkbox",
      default: false,
      showWhen: "shrinkEnabled && isRect"
    },
    {
      key: "shrinkSlide",
      label: "Shrink slide",
      kind: "range",
      default: 0,
      min: 0,
      max: 100,
      step: 0.1,
      unit: "%",
      showWhen: "shrinkEnabled && !optimiseShrinkEnabled && isRect"
    },
    {
      key: "exactArea",
      label: "Exact area",
      kind: "checkbox",
      default: false,
      showWhen: "shrinkEnabled && isRect"
    }
  ]
};

// src/floorplan/flow/declarations/densify.node.json
var densify_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "densify",
  meta: {
    label: "Resample",
    category: "Reshape",
    color: "#16a34a"
  },
  description: "A pure CALCULATION node \u2014 add vertices along the boundary (shape unchanged): coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon. A nested [[[x,y],...],...] list (from Split / Voronoi / BSP \u2026) is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "maxLength",
        label: "Max segment length"
      },
      {
        key: "count",
        label: "Points / edge"
      },
      {
        key: "rdpTol",
        label: "Tolerance"
      },
      {
        key: "targetVertices",
        label: "Target vertices"
      },
      {
        key: "stride",
        label: "Keep every Nth"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "length",
      options: [
        {
          value: "length",
          label: "Densify \xB7 by max length"
        },
        {
          value: "count",
          label: "Densify \xB7 points / edge"
        },
        {
          value: "collinear",
          label: "Simplify \xB7 remove collinear"
        },
        {
          value: "rdp",
          label: "Simplify \xB7 Douglas-Peucker"
        },
        {
          value: "visvalingam",
          label: "Simplify \xB7 target vertices"
        },
        {
          value: "stride",
          label: "Reduce \xB7 keep every Nth"
        }
      ]
    },
    {
      key: "maxLength",
      label: "Max segment length",
      kind: "range",
      default: 5,
      min: 0.2,
      max: 50,
      step: 0.2,
      unit: "m",
      showWhen: "mode == 'length'"
    },
    {
      key: "count",
      label: "Points / edge",
      kind: "range",
      default: 2,
      min: 1,
      max: 20,
      step: 1,
      showWhen: "mode == 'count'"
    },
    {
      key: "collinearTol",
      label: "Angle tolerance",
      kind: "range",
      default: 1,
      min: 0,
      max: 30,
      step: 0.5,
      unit: "\xB0",
      showWhen: "mode == 'collinear'"
    },
    {
      key: "rdpTol",
      label: "Tolerance",
      kind: "range",
      default: 1,
      min: 0.05,
      max: 20,
      step: 0.05,
      unit: "m",
      showWhen: "mode == 'rdp'"
    },
    {
      key: "targetVertices",
      label: "Target vertices",
      kind: "range",
      default: 8,
      min: 3,
      max: 60,
      step: 1,
      showWhen: "mode == 'visvalingam'"
    },
    {
      key: "stride",
      label: "Keep every Nth",
      kind: "range",
      default: 2,
      min: 2,
      max: 10,
      step: 1,
      showWhen: "mode == 'stride'"
    }
  ]
};

// src/floorplan/flow/declarations/loop.node.json
var loop_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "loop",
  meta: { label: "Loop", category: "Partition", color: "#7c3aed" },
  description: "Array the input N times \u2014 copy i steps by (Step X, Step Y) metres and Step Rotation\xB0. The general parametric-count builder (e.g. a staircase run = one tread looped `steps` times along `going`).",
  instructions: "Repeats its input geometry `count` times. Copy i is translated by (i\xB7Step X, i\xB7Step Y) metres and rotated i\xB7Step Rotation\xB0 about the input's own centroid, so the copies form a linear (or spiralling) array. EVERY parameter is wireable (valin-*): drive `count` from an Input Properties `steps` value and `Step X` from `going` to build a straight staircase run in plan entirely from flow nodes \u2014 no 2D/3D render engine. Outputs every copy on one handle; wire onward or commit to draw the array.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "count", label: "Count" },
      { key: "stepX", label: "Step X" },
      { key: "stepY", label: "Step Y" },
      { key: "stepRot", label: "Step Rotation" }
    ]
  },
  parameters: [
    { key: "count", label: "Count", kind: "range", default: 12, min: 0, max: 100, step: 1 },
    { key: "stepX", label: "Step X", kind: "number", default: 0.28, step: 0.01, unit: "m" },
    { key: "stepY", label: "Step Y", kind: "number", default: 0, step: 0.01, unit: "m" },
    { key: "stepRot", label: "Step Rotation", kind: "number", default: 0, step: 1, unit: "\xB0" }
  ]
};

// src/floorplan/flow/declarations/match.node.json
var match_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "match",
  meta: { label: "Match", category: "Calculate", color: "#ca8a04" },
  description: "result = 1 when the wired value equals Match, else 0. The select-branching primitive: turn a select param ('u-shape') into a 0/1 gate that drives Loop counts.",
  instructions: "String/number equality test: publishes `val-result` = 1 when the wired `value` equals the `match` text, else 0. This is how a SELECT parameter branches a flow: wire a select's value (e.g. an Input Properties / Parametric Object `config`) into Value, set Match to one option ('straight' / 'u-shape'), and multiply the resulting 0/1 into a Loop's Count \u2014 the branch's geometry vanishes when the option isn't active (count 0 = no copies).\n\nTIP: one Match node per option, then `count = N \xD7 match` via a Math node.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "value", label: "Value" }
    ],
    valueOutputs: [
      { key: "result", label: "1 / 0" }
    ]
  },
  parameters: [
    { key: "value", label: "Value (if no input)", kind: "text", default: "" },
    { key: "match", label: "Match", kind: "text", default: "", placeholder: "e.g. u-shape" }
  ]
};

// src/floorplan/flow/declarations/loop-3d.node.json
var loop_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "loop-3d",
  meta: { label: "Loop 3D", category: "3d primitives", color: "#0e7490" },
  description: "Array the input 3D primitive N times \u2014 copy i shifts by (Step X, Step Y) plan-metres and grows (or lifts) by i\xB7Step Rise. The parametric-count builder in 3D: a staircase = one tread Cuboid looped `steps` times with Step Rise = riser.",
  instructions: "Repeats an upstream 3D primitive (Cuboid / Cylinder / \u2026) `count` times. Copy i is shifted by (i\xB7Step X, i\xB7Step Y) metres in plan and its height GROWS by i\xB7Step Rise (base stays on the floor \u2014 solid staircase columns, exactly like the Staircase node's 3D). Tick `liftBase` to LIFT each copy instead (constant height, floating treads).\n\nEvery parameter is wireable: drive `count` from a params node's steps, `Step X` from the tread and `Step Rise` from the riser to build a staircase run from general nodes. Count 0 \u2192 the branch vanishes (how a Match gate disables a configuration).",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "count", label: "Count" },
      { key: "stepX", label: "Step X" },
      { key: "stepY", label: "Step Y" },
      { key: "stepRise", label: "Step Rise" },
      { key: "show", label: "Show" }
    ]
  },
  parameters: [
    { key: "count", label: "Count", kind: "range", default: 1, min: 0, max: 100, step: 1 },
    { key: "stepX", label: "Step X", kind: "number", default: 0, step: 0.01, unit: "m" },
    { key: "stepY", label: "Step Y", kind: "number", default: 0, step: 0.01, unit: "m" },
    { key: "stepRise", label: "Step Rise", kind: "number", default: 0, step: 5e-3, unit: "m" },
    { key: "liftBase", label: "Lift base (floating treads)", kind: "checkbox", default: false },
    { key: "show", label: "Show", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/inset.node.json
var inset_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "inset",
  meta: {
    label: "Inset",
    category: "Reshape",
    color: "#0369a1"
  },
  description: "A pure CALCULATION node \u2014 offset the boundary inward or outward: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry\'s val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nPARAMETERS (JSON): the `valin-params` endpoint takes a whole parameter object at once \u2014 { "mode": "equal", "uniformSetback": 0.8, "inside": true, ... } \u2014 merged over the node\'s own params, coerced by field kind. Wire an Agent\'s output here to let it set every parameter in one connection. Individual valin-* endpoints still work and win over the bag.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "params",
        label: "Parameters (JSON)"
      },
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "uniformSetback",
        label: "Offset"
      },
      {
        key: "front",
        label: "Front offset"
      },
      {
        key: "remaining",
        label: "Remaining offset"
      },
      {
        key: "frontEdgeIndex",
        label: "Edge index"
      },
      {
        key: "inside",
        label: "Inside"
      },
      {
        key: "mode",
        label: "Mode"
      },
      {
        key: "frontEdgeMode",
        label: "Front edge"
      },
      {
        key: "setbacks",
        label: "Setbacks"
      }
    ],
    valueOutputs: [
      {
        key: "area",
        label: "Area",
        unit: "m\xB2"
      },
      {
        key: "points",
        label: "Points"
      },
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "inside",
      label: "Inside",
      kind: "checkbox",
      default: true
    },
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "equal",
      options: [
        {
          value: "equal",
          label: "Equal"
        },
        {
          value: "front-remaining",
          label: "Front & Remaining"
        },
        {
          value: "variable",
          label: "Per-edge"
        }
      ]
    },
    {
      key: "uniformSetback",
      label: "Offset",
      kind: "range",
      default: 1,
      min: 0,
      max: 5,
      step: 0.05,
      unit: "m",
      showWhen: "mode == 'equal'"
    },
    {
      key: "front",
      label: "Front offset",
      kind: "range",
      default: 0,
      min: 0,
      max: 5,
      step: 0.05,
      unit: "m",
      showWhen: "mode == 'front-remaining'"
    },
    {
      key: "remaining",
      label: "Remaining offset",
      kind: "range",
      default: 0,
      min: 0,
      max: 5,
      step: 0.05,
      unit: "m",
      showWhen: "mode == 'front-remaining'"
    },
    {
      key: "frontEdgeMode",
      label: "Front edge",
      kind: "select",
      default: "longest",
      options: [
        {
          value: "longest",
          label: "Longest (auto)"
        },
        {
          value: "index",
          label: "By edge index"
        }
      ],
      showWhen: "mode == 'front-remaining'"
    },
    {
      key: "frontEdgeIndex",
      label: "Edge index",
      kind: "range",
      default: 0,
      min: 0,
      max: 19,
      step: 1,
      showWhen: "mode == 'front-remaining' && frontEdgeMode == 'index'"
    },
    {
      key: "setbacks",
      label: "Setbacks (per edge)",
      kind: "text",
      default: "1, 0.5, 0.5",
      placeholder: "1, 0.5, 0.5, 2",
      showWhen: "mode == 'variable'"
    }
  ]
};

// src/floorplan/flow/declarations/bounding-shape.node.json
var bounding_shape_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "bounding-shape",
  meta: {
    label: "Bounding Shapes",
    category: "Reshape",
    color: "#059669"
  },
  description: "A pure CALCULATION node \u2014 fit a bounding shape (rectangle / circle / n-gon): coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon. A nested [[[x,y],...],...] list (from Split / Voronoi / BSP \u2026) is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "shape",
      label: "Shape",
      kind: "select",
      default: "ngon",
      options: [
        {
          value: "circle",
          label: "Circumcircle"
        },
        {
          value: "ellipse",
          label: "Min. ellipse"
        },
        {
          value: "ngon",
          label: "Regular n-gon"
        }
      ]
    },
    {
      key: "sides",
      label: "Sides (n)",
      kind: "range",
      default: 6,
      min: 3,
      max: 12,
      step: 1,
      showWhen: "shape == 'ngon'"
    },
    {
      key: "angle",
      label: "Angle",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 0.5,
      unit: "\xB0",
      showWhen: "shape == 'ngon' && !optimize"
    },
    {
      key: "optimize",
      label: "Optimise orientation",
      kind: "checkbox",
      default: false,
      showWhen: "shape == 'ngon'"
    }
  ]
};

// src/floorplan/flow/declarations/convex-hull.node.json
var convex_hull_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "convex-hull",
  meta: {
    label: "Convex Hull",
    category: "Reshape",
    color: "#0369a1"
  },
  description: "A pure CALCULATION node \u2014 compute the convex hull: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon. A nested [[[x,y],...],...] list (from Split / Voronoi / BSP \u2026) is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    }
  ]
};

// src/floorplan/flow/declarations/smoothing.node.json
var smoothing_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "smoothing",
  meta: {
    label: "Smoothing",
    category: "Reshape",
    color: "#9f1239"
  },
  description: "A pure CALCULATION node \u2014 round the boundary (Chaikin / Bezier): coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon. A nested [[[x,y],...],...] list (from Split / Voronoi / BSP \u2026) is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "type",
      label: "Type",
      kind: "select",
      default: "chaikin",
      options: [
        {
          value: "chaikin",
          label: "Chaikin corner"
        },
        {
          value: "bezier",
          label: "B\xE9zier fillet"
        }
      ]
    },
    {
      key: "level",
      label: "Smoothing level",
      kind: "range",
      default: 0.4,
      min: 0,
      max: 1,
      step: 0.02
    },
    {
      key: "restrictInside",
      label: "Restrict inside polygon",
      kind: "checkbox",
      default: false
    },
    {
      key: "curveShortening",
      label: "Curved shortening",
      kind: "range",
      default: 0,
      min: 0,
      max: 100,
      step: 1,
      unit: "%"
    }
  ]
};

// src/floorplan/flow/declarations/contour.node.json
var contour_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "contour",
  meta: {
    label: "Contour",
    category: "Reshape",
    color: "#0e7490"
  },
  description: "A pure CALCULATION node \u2014 offset the boundary into contour rings: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "interval",
      label: "Interval",
      kind: "range",
      default: 0.5,
      min: 0.05,
      max: 10,
      step: 0.05,
      unit: "m"
    },
    {
      key: "maxLevels",
      label: "Max levels",
      kind: "range",
      default: 12,
      min: 1,
      max: 30,
      step: 1
    }
  ]
};

// src/floorplan/flow/declarations/point.node.json
var point_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "point",
  meta: {
    label: "Point",
    category: "2d primitives",
    color: "#ca8a04"
  },
  description: "An (x, y) point in metres \u2014 feeds val-x / val-y (e.g. a Visibility viewer offset).",
  instructions: "A value source \u2014 publishes an (x, y) point in metres on `val-x` / `val-y` (it has no geometry of its own). Wire those outputs into any node that takes a scalar or a viewer offset (e.g. a Visibility Polygon's viewer X/Y). The X/Y can themselves be driven by wiring numbers into `valin-x` / `valin-y`.\n\nTIP: use it as a single adjustable coordinate that several downstream nodes read \u2014 move the point and everything that references it follows.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "x", label: "X" },
      { key: "y", label: "Y" }
    ],
    valueOutputs: [
      { key: "x", label: "X", unit: "m" },
      { key: "y", label: "Y", unit: "m" }
    ]
  },
  parameters: [
    { key: "x", label: "X", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "y", label: "Y", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" }
  ]
};

// src/floorplan/flow/declarations/vertices.node.json
var vertices_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "vertices",
  meta: {
    label: "Vertices",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "A vertex list ([[x,y],\u2026 metre pairs) \u2014 receives vertices and republishes them. Draws nothing.",
  instructions: "A pure VALUE node for a vertex list: it receives vertices on `valin-points` and republishes them on `val-points`. It draws NOTHING on the canvas and emits no Space \u2014 wire it into a Polygon node when you want the list drawn.\n\nUse it to carry an outline between operations, e.g. Space Geometry \u2192 Vertices \u2192 Inset (`valin-polygon`), or Vertices \u2192 Polygon.\n\nA wired list overrides the typed one; with nothing wired the typed list is published as-is, so it also works as a standalone coordinate source.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "points",
        label: "Points"
      }
    ],
    valueOutputs: [
      {
        key: "points",
        label: "Points"
      }
    ]
  },
  parameters: [
    {
      key: "points",
      label: "Points (JSON)",
      kind: "text",
      default: "[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]"
    }
  ]
};

// src/floorplan/flow/declarations/network.node.json
var network_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "network",
  meta: {
    label: "Network",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: `2D primitive \u2014 draws a graph JSON on the canvas as real SEGMENTS: nodes place the points, every edge becomes a canvas wall. The row's Thickness / Segment type / Layer are stamped on each one, and Attach object hosts a segment-hosted library object (door.json / window.json) on it \u2014 which is what makes a generated plan editable element by element instead of a drawing. Object params (JSON) binds the hosted object's own fields to this row \u2014 {"thickness": 0.23} makes a Wall object match the segment it sits on \u2014 and a door / window row additionally renders as an OPENING, so the band is a gap and the object draws the leaf or the frame. Display mode arrives on every segment the row draws, so a generated wall is already "Buffered" without visiting each one in Segment Properties. Fill paints the band Outlined (stroke only \u2014 the drafting default), Filled, or Hatched with a 45\xB0 poch\xE9 pattern, so the CANVAS draws the whole wall and the hosted Wall object need not draw a 2D band at all. Wall join sets how the bands meet at shared endpoints: "Mitered union" merges every connected run into ONE seamless outline (no line across a corner or a T), "Mitered" closes each corner but still strokes each wall, "Individual bands" is the raw rectangle per segment.`,
  instructions: 'A 2D primitive source that DRAWS a graph. Feed `graph` (or wire `valin-graph`) with the JSON that Graph Geometry and Skeleton\'s `val-branches` publish:\n\n{ "nodes": [{ "id": "n1", "x": 0, "y": 0 }, \u2026],\n  "edges": [{ "from_node_id": "n1", "to_node_id": "n2" }, \u2026] }\n\nEvery edge is drawn as an open 2-point segment between its endpoint nodes, and flows on downstream as a polyline \u2014 feed it into Mitered Join to stroke the network into walls.\n\nCoordinates are METRES local to the anchor, the same convention every other 2D primitive uses. Nodes given as bare id strings carry no position, so edges referencing them are skipped \u2014 publish nodes as {id,x,y} objects. `val-nodeCount` / `val-edgeCount` report what was actually placed and drawn.\n\nWALL JOIN + DISPLAY MODE work together, and which field carries the join depends on the display:\n\n\u2022 BUFFERED / PATH row \u2014 "Mitered union (seamless)" pins the band to the merged outline via the segment\'s own `bufferJoin`, leaving `mode` free for Fill (Outlined / Filled / Hatched). The two are independent there, so a run can be Outlined AND seamless. A hatched union carries its poch\xE9 pattern on the merged shape, since the per-segment bands render stroke-less underneath it.\n\u2022 LINE row \u2014 the join lives in the segment\'s `mode`, exactly as it does for a hand-drawn wall.\n\u2022 "Auto (canvas view)" on either \u2014 the canvas decides: Preferences \u2192 Buffered Segment Joins for a buffered band, the Sharp / Filling+Union view for a line one.\n\nPinning matters because a generated plan should not need a preference flipped by hand before its walls read as masonry.',
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "thickness",
        label: "Thickness (m)"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "thickness",
      label: "Thickness",
      kind: "range",
      default: 0.12,
      min: 0.02,
      max: 1,
      step: 0.01,
      unit: "m"
    },
    {
      key: "segmentType",
      label: "Segment type",
      kind: "select",
      default: "wall",
      options: [
        {
          value: "wall",
          label: "Wall"
        },
        {
          value: "door",
          label: "Door"
        },
        {
          value: "window",
          label: "Window"
        },
        {
          value: "line",
          label: "Line"
        },
        {
          value: "path",
          label: "Path"
        }
      ]
    },
    {
      key: "wallMode",
      label: "Wall join",
      kind: "select",
      default: "auto",
      options: [
        {
          value: "auto",
          label: "Auto (canvas view)"
        },
        {
          value: "mitered-union",
          label: "Mitered union (seamless)"
        },
        {
          value: "mitered",
          label: "Mitered (per wall)"
        },
        {
          value: "fill",
          label: "Individual bands"
        },
        {
          value: "line",
          label: "Line"
        }
      ],
      showWhen: "segmentType == 'wall'"
    },
    {
      key: "display",
      label: "Display mode",
      kind: "select",
      default: "line",
      options: [
        {
          value: "line",
          label: "Line (thin styled stroke)"
        },
        {
          value: "buffered",
          label: "Buffered (thickness band)"
        },
        {
          value: "path",
          label: "Path (band + live Space)"
        }
      ],
      showWhen: "segmentType == 'wall'"
    },
    {
      key: "bufferStyle",
      label: "Buffer cap",
      kind: "select",
      default: "flat",
      options: [
        {
          value: "flat",
          label: "Flat (butt)"
        },
        {
          value: "square",
          label: "Square (extended)"
        },
        {
          value: "capsule",
          label: "Capsule (rounded)"
        }
      ],
      showWhen: "segmentType == 'wall' && display != 'line'"
    },
    {
      key: "fill",
      label: "Fill",
      kind: "select",
      default: "outlined",
      options: [
        {
          value: "outlined",
          label: "Outlined (stroke only)"
        },
        {
          value: "filled",
          label: "Filled (solid)"
        },
        {
          value: "hatched",
          label: "Hatched (poch\xE9 pattern)"
        }
      ],
      showWhen: "segmentType == 'wall' && display != 'line'"
    },
    {
      key: "extrude3d",
      label: "Extrude in 3D",
      kind: "checkbox",
      default: true
    },
    {
      key: "hatchStyle",
      label: "Hatch Style",
      kind: "select",
      default: "diagonal",
      options: [
        {
          value: "diagonal",
          label: "Diagonal lines"
        },
        {
          value: "dots",
          label: "Random dots"
        }
      ],
      showWhen: "fill == 'hatched'"
    },
    {
      key: "hatchSpacing",
      label: "Spacing",
      kind: "range",
      default: 8,
      min: 3,
      max: 40,
      step: 1,
      unit: "px",
      showWhen: "fill == 'hatched'"
    },
    {
      key: "hatchAngle",
      label: "Angle",
      kind: "range",
      default: 45,
      min: 0,
      max: 180,
      step: 1,
      unit: "\xB0",
      showWhen: "fill == 'hatched' && hatchStyle == 'diagonal'"
    },
    {
      key: "hatchWeight",
      label: "Weight",
      kind: "range",
      default: 1,
      min: 0.5,
      max: 5,
      step: 0.5,
      unit: "px",
      showWhen: "fill == 'hatched'"
    },
    {
      key: "typeMap",
      label: "Per-type overrides (JSON)",
      kind: "text",
      default: "",
      placeholder: '{"door": {"objectId": "door-with-math", "layer": "Doors", "segmentType": "door"}}'
    },
    {
      key: "objectId",
      label: "Attach object (id)",
      kind: "text",
      default: ""
    },
    {
      key: "objectParams",
      label: "Object params (JSON)",
      kind: "text",
      default: "",
      placeholder: '{"thickness": 0.23}'
    },
    {
      key: "extraObjects",
      label: "Also host (JSON array)",
      kind: "text",
      default: "",
      placeholder: '[{"objectId":"wall-with-math","params":{"base":2.1,"height":0.7}}]'
    },
    {
      key: "layer",
      label: "Layer",
      kind: "text",
      default: ""
    },
    {
      key: "release",
      label: "Release on commit",
      kind: "checkbox",
      default: false
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSegments: true
};

// src/floorplan/flow/declarations/rectangle.node.json
var rectangle_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "rectangle",
  meta: {
    label: "Rectangle",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 a Length \xD7 Breadth rectangle centred at (X, Y) in metres. Emits a Space polygon.",
  instructions: "A 2D primitive source \u2014 emits a Length \xD7 Breadth rectangle Space centred at (centerX, centerY) in metres, optionally rotated. It has no geometry input; feed its output into the Space pipeline exactly like a Space source. Also publishes `val-length` / `val-breadth` for wiring downstream.\n\nTIP: use it as a quick test Space, or a parametric footprint whose size is driven by wiring numbers into `valin-length` / `valin-breadth` (e.g. from a Math node).",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "length",
        label: "Length"
      },
      {
        key: "breadth",
        label: "Breadth"
      },
      {
        key: "centerX",
        label: "Center X"
      },
      {
        key: "centerY",
        label: "Center Y"
      },
      {
        key: "rotation",
        label: "Rotation"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "length",
        label: "Length",
        unit: "m"
      },
      {
        key: "breadth",
        label: "Breadth",
        unit: "m"
      },
      {
        key: "points",
        label: "Points (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "length",
      label: "Length",
      kind: "range",
      default: 4,
      min: 0.5,
      max: 100,
      step: 0.5,
      unit: "m"
    },
    {
      key: "breadth",
      label: "Breadth",
      kind: "range",
      default: 3,
      min: 0.5,
      max: 100,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerX",
      label: "Center X",
      kind: "number",
      default: 0,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerY",
      label: "Center Y",
      kind: "number",
      default: 0,
      step: 0.5,
      unit: "m"
    },
    {
      key: "rotation",
      label: "Rotation",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSpace: true
};

// src/floorplan/flow/declarations/arc.node.json
var arc_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "arc",
  meta: {
    label: "Arc",
    category: "2d primitives",
    color: "#ca8a04"
  },
  description: "A 2D arc (open polyline): centre (x, y), radius, from Start angle to End angle (degrees).",
  instructions: "Draws a circular arc as an OPEN polyline \u2014 centred at (centerX, centerY) in metres, of the given radius, sweeping from Start angle to End angle (degrees, the short way). Every field can be wired from a Math or Math Engine node, so it's ideal for a door swing (centre = hinge, radius = leaf width, Start = closed, End = open). It has no fill.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "centerX",
        label: "Center X"
      },
      {
        key: "centerY",
        label: "Center Y"
      },
      {
        key: "radius",
        label: "Radius"
      },
      {
        key: "startAngle",
        label: "Start angle"
      },
      {
        key: "endAngle",
        label: "End angle"
      },
      {
        key: "show",
        label: "Show"
      }
    ]
  },
  parameters: [
    {
      key: "centerX",
      label: "Center X",
      kind: "number",
      default: 0,
      step: 0.1,
      unit: "m"
    },
    {
      key: "centerY",
      label: "Center Y",
      kind: "number",
      default: 0,
      step: 0.1,
      unit: "m"
    },
    {
      key: "radius",
      label: "Radius",
      kind: "range",
      default: 1,
      min: 0.05,
      max: 20,
      step: 0.05,
      unit: "m"
    },
    {
      key: "startAngle",
      label: "Start angle",
      kind: "number",
      default: 0,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "endAngle",
      label: "End angle",
      kind: "number",
      default: 90,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: "#9333ea"
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSegments: true
};

// src/floorplan/flow/declarations/circle.node.json
var circle_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "circle",
  meta: {
    label: "Circle",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 a circle of the given radius centred at (X, Y) in metres. Emits a Space polygon.",
  instructions: "A 2D primitive source \u2014 emits a circular Space (a 48-gon) of `radius` centred at (centerX, centerY) in metres. It has no geometry input; feed its output into the Space pipeline like a source. Publishes `val-radius` for wiring downstream.\n\nTIP: use it for radial studies or as a seed Space; wire `val-radius` into downstream sizing, or into a Bounding Shapes / Inset chain.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "radius",
        label: "Radius"
      },
      {
        key: "centerX",
        label: "Center X"
      },
      {
        key: "centerY",
        label: "Center Y"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "radius",
        label: "Radius",
        unit: "m"
      },
      {
        key: "points",
        label: "Points (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "radius",
      label: "Radius",
      kind: "range",
      default: 3,
      min: 0.5,
      max: 50,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerX",
      label: "Center X",
      kind: "number",
      default: 0,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerY",
      label: "Center Y",
      kind: "number",
      default: 0,
      step: 0.5,
      unit: "m"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSpace: true
};

// src/floorplan/flow/declarations/polygon.node.json
var polygon_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "polygon",
  meta: {
    label: "Polygon",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 one filled polygon, or SEVERAL, drawn from a vertex list (metres, local to the anchor). Emits a Space per polygon.",
  instructions: "A 2D primitive source \u2014 a closed polygon Space built from `points` (a JSON array of [x, y] metre pairs, local to the flow anchor). No geometry input; feed its output into the Space pipeline like a Rectangle.\n\n`points` is wireable: connect a Vertices node's (or Space Geometry's) `val-points` into `valin-points` to DRAW that vertex list. A wired list overrides the typed one. The resolved outline is echoed on `val-points`. Wire `valin-color` to tint it. Used by object decompile to represent a `poly` rule (angled / freeform parts).\n\nMULTIPLE POLYGONS: points accepts either a single outline [[x,y],...] or a LIST of outlines [[[x,y],...],...]. Wire Skeleton val-polygons (Regions mode) straight in to draw every region at once. The echo on val-points mirrors the count \u2014 one polygon echoes flat so single-outline consumers such as Inset valin-polygon always match; several echo nested.\n\nLAYER: the `Layer` param names the canvas layer this polygon's Space is rendered on (with Flow Live on). Blank falls back to the node's own Live layer; several polygons sharing a name land on ONE layer. A palette-added Polygon auto-names it Polygon1 / Polygon2 / \u2026 .\n\nGROUP COLUMN: a flat list whose rows carry a THIRD number splits into one outline per RUN of equal third value. That is how a Math Engine publishes several outlines at once \u2014 an Expression can only emit a rectangular matrix, never the nested form \u2014 and it lets the outlines differ in length: build them with `Q = vcat(Q, hcat(ring, fill(rows(ring),1,i)))` inside a loop, the same work-list idiom the engine's own loops use, and wire `val-Q` in. A constant third column is a single outline, i.e. unchanged behaviour. See Workflows/Operations/mitered_join_with_math.json.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "points",
        label: "Points"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "points",
        label: "Points"
      }
    ]
  },
  parameters: [
    {
      key: "points",
      label: "Points (JSON)",
      kind: "text",
      default: "[[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,0.5]]"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "layer",
      label: "Layer",
      kind: "text",
      default: "",
      placeholder: "Polygon1"
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSpace: true
};

// src/floorplan/flow/declarations/polyline.node.json
var polyline_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "polyline",
  meta: {
    label: "Polyline",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 an open polyline from a list of points (metres). Draws as a stroke; no fill, no 3D.",
  instructions: "A 2D open polyline \u2014 a construction / detail line from `points` (a JSON array of [x, y] metre pairs, local to the flow anchor). Drawn as a stroke only (no fill, no 3D), like a `line` rule in a parametric object. Wire `valin-color` to tint it. Used by object decompile to represent a `line` rule (seams, trims, glazing lines).\n\nGROUP COLUMN: a flat list whose rows carry a THIRD number splits into one outline per RUN of equal third value. That is how a Math Engine publishes several outlines at once \u2014 an Expression can only emit a rectangular matrix, never the nested form \u2014 and it lets the outlines differ in length: build them with `Q = vcat(Q, hcat(ring, fill(rows(ring),1,i)))` inside a loop, the same work-list idiom the engine's own loops use, and wire `val-Q` in. A constant third column is a single outline, i.e. unchanged behaviour. See Workflows/Operations/mitered_join_with_math.json.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ]
  },
  parameters: [
    {
      key: "points",
      label: "Points (JSON)",
      kind: "text",
      default: "[[-0.5,0],[0.5,0]]"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSegments: true
};

// src/floorplan/flow/declarations/line.node.json
var line_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "line",
  meta: {
    label: "Line",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 a straight line from (X1, Y1) to (X2, Y2) in metres. An open stroke (no fill, no downstream Space); every endpoint coordinate is wireable.",
  instructions: "A 2D line SEGMENT from (x1, y1) to (x2, y2) in metres \u2014 an OPEN stroke, so it draws linework (symbols, axes, leaders) and flows on as a 2-point polyline (e.g. into Mitered Join to stroke it into a wall). Every coordinate is wireable (valin-*): drive the endpoints from a Math Engine / Segment Geometry to draw wall-aligned symbol lines. Publishes `val-length` (m).",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "x1",
        label: "X1"
      },
      {
        key: "y1",
        label: "Y1"
      },
      {
        key: "x2",
        label: "X2"
      },
      {
        key: "y2",
        label: "Y2"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "length",
        label: "Length",
        unit: "m"
      }
    ]
  },
  parameters: [
    {
      key: "x1",
      label: "X1",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.1,
      unit: "m"
    },
    {
      key: "y1",
      label: "Y1",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.1,
      unit: "m"
    },
    {
      key: "x2",
      label: "X2",
      kind: "range",
      default: 3,
      min: -200,
      max: 200,
      step: 0.1,
      unit: "m"
    },
    {
      key: "y2",
      label: "Y2",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.1,
      unit: "m"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSegments: true
};

// src/floorplan/flow/declarations/ngon.node.json
var ngon_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "ngon",
  meta: {
    label: "N-gon",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 a regular N-sided polygon (triangle / hex / octagon \u2026) of the given Radius, centred at (X, Y), optionally rotated. Emits a Space polygon.",
  instructions: "A regular N-GON \u2014 `sides` vertices on a circle of `radius` metres, centred at (centerX, centerY), rotated by `rotation`\xB0. Emits a closed Space polygon downstream, exactly like Rectangle / Circle. All params wireable \u2014 drive `sides` from an Input Properties slider for a parametric hex column / plate. Publishes `val-radius`.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "sides",
        label: "Sides"
      },
      {
        key: "radius",
        label: "Radius"
      },
      {
        key: "centerX",
        label: "Center X"
      },
      {
        key: "centerY",
        label: "Center Y"
      },
      {
        key: "rotation",
        label: "Rotation"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "radius",
        label: "Radius",
        unit: "m"
      }
    ]
  },
  parameters: [
    {
      key: "sides",
      label: "Sides",
      kind: "range",
      default: 6,
      min: 3,
      max: 24,
      step: 1
    },
    {
      key: "radius",
      label: "Radius",
      kind: "range",
      default: 2,
      min: 0.1,
      max: 100,
      step: 0.1,
      unit: "m"
    },
    {
      key: "centerX",
      label: "Center X",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerY",
      label: "Center Y",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "rotation",
      label: "Rotation",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSpace: true
};

// src/floorplan/flow/declarations/ellipse.node.json
var ellipse_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "ellipse",
  meta: {
    label: "Ellipse",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 an ellipse of Radius X \xD7 Radius Y metres centred at (X, Y), optionally rotated. Emits a Space polygon.",
  instructions: "An ELLIPSE \u2014 semi-axes `radiusX` \xD7 `radiusY` metres, centred at (centerX, centerY), rotated by `rotation`\xB0. Emits a closed Space polygon downstream (tables, basins, ovals). All params wireable. Publishes `val-radiusX` / `val-radiusY`.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "radiusX",
        label: "Radius X"
      },
      {
        key: "radiusY",
        label: "Radius Y"
      },
      {
        key: "centerX",
        label: "Center X"
      },
      {
        key: "centerY",
        label: "Center Y"
      },
      {
        key: "rotation",
        label: "Rotation"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "radiusX",
        label: "Radius X",
        unit: "m"
      },
      {
        key: "radiusY",
        label: "Radius Y",
        unit: "m"
      }
    ]
  },
  parameters: [
    {
      key: "radiusX",
      label: "Radius X",
      kind: "range",
      default: 2,
      min: 0.1,
      max: 100,
      step: 0.1,
      unit: "m"
    },
    {
      key: "radiusY",
      label: "Radius Y",
      kind: "range",
      default: 1.2,
      min: 0.1,
      max: 100,
      step: 0.1,
      unit: "m"
    },
    {
      key: "centerX",
      label: "Center X",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerY",
      label: "Center Y",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "rotation",
      label: "Rotation",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSpace: true
};

// src/floorplan/flow/declarations/rounded-rect.node.json
var rounded_rect_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "rounded-rect",
  meta: {
    label: "Rounded Rectangle",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 a Length \xD7 Breadth rectangle with filleted corners (Corner Radius), centred at (X, Y), optionally rotated. Emits a Space polygon.",
  instructions: "A ROUNDED RECTANGLE \u2014 Length \xD7 Breadth with each corner filleted at `cornerRadius` metres (clamped to half the smaller side; radius = half the smaller side \u21D2 a stadium / slot). Centred at (centerX, centerY), rotated by `rotation`\xB0. Emits a closed Space polygon (furniture, rugs, pads). All params wireable. Publishes `val-length` / `val-breadth`.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "length",
        label: "Length"
      },
      {
        key: "breadth",
        label: "Breadth"
      },
      {
        key: "cornerRadius",
        label: "Corner Radius"
      },
      {
        key: "centerX",
        label: "Center X"
      },
      {
        key: "centerY",
        label: "Center Y"
      },
      {
        key: "rotation",
        label: "Rotation"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "length",
        label: "Length",
        unit: "m"
      },
      {
        key: "breadth",
        label: "Breadth",
        unit: "m"
      }
    ]
  },
  parameters: [
    {
      key: "length",
      label: "Length",
      kind: "range",
      default: 3,
      min: 0.2,
      max: 100,
      step: 0.1,
      unit: "m"
    },
    {
      key: "breadth",
      label: "Breadth",
      kind: "range",
      default: 2,
      min: 0.2,
      max: 100,
      step: 0.1,
      unit: "m"
    },
    {
      key: "cornerRadius",
      label: "Corner Radius",
      kind: "range",
      default: 0.3,
      min: 0,
      max: 10,
      step: 0.05,
      unit: "m"
    },
    {
      key: "centerX",
      label: "Center X",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerY",
      label: "Center Y",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "rotation",
      label: "Rotation",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSpace: true
};

// src/floorplan/flow/declarations/sector.node.json
var sector_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "sector",
  meta: {
    label: "Sector",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "2D primitive \u2014 a FILLED pie wedge: centre (X, Y), Radius, from Start to End angle (degrees). Equal angles = a full disc. Emits a Space polygon.",
  instructions: "A filled SECTOR (pie wedge) \u2014 centre (centerX, centerY), `radius` metres, swept from `startAngle` to `endAngle` (degrees; the sweep is end \u2212 start normalised into (0\xB0, 360\xB0], so equal angles give a FULL disc). Unlike Arc (an open stroke) this is a closed, filled Space \u2014 door-swing fills, circular stair treads, fan zones. All params wireable. Publishes `val-radius` / `val-sweep`.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "radius",
        label: "Radius"
      },
      {
        key: "startAngle",
        label: "Start Angle"
      },
      {
        key: "endAngle",
        label: "End Angle"
      },
      {
        key: "centerX",
        label: "Center X"
      },
      {
        key: "centerY",
        label: "Center Y"
      },
      {
        key: "color",
        label: "Colour"
      },
      {
        key: "show",
        label: "Show"
      }
    ],
    valueOutputs: [
      {
        key: "radius",
        label: "Radius",
        unit: "m"
      },
      {
        key: "sweep",
        label: "Sweep",
        unit: "\xB0"
      }
    ]
  },
  parameters: [
    {
      key: "radius",
      label: "Radius",
      kind: "range",
      default: 2,
      min: 0.1,
      max: 100,
      step: 0.1,
      unit: "m"
    },
    {
      key: "startAngle",
      label: "Start Angle",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "endAngle",
      label: "End Angle",
      kind: "range",
      default: 90,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "centerX",
      label: "Center X",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "centerY",
      label: "Center Y",
      kind: "range",
      default: 0,
      min: -200,
      max: 200,
      step: 0.5,
      unit: "m"
    },
    {
      key: "color",
      label: "Colour",
      kind: "color",
      default: ""
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ],
  materialisesSpace: true
};

// src/floorplan/flow/declarations/bua.node.json
var bua_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "bua",
  meta: {
    label: "BUA Calculator",
    category: "Calculate",
    color: "#0d9488"
  },
  description: "Connect a space for plot area \u2192 FSI BUA (max permissible) + Non-FSI BUA.",
  instructions: "Takes a Space as input to read its plot area (falls back to fields when unconnected) and computes FSI BUA (max permissible built-up area) + Non-FSI BUA \u2014 emitted on `val-fsiBua` / `val-nonFsiBua`. The input Space passes straight through the geometry output (no-op) so the pipeline continues.\n\nThe bottom block (front, remaining, edge index, ratio, split angle, axis tilt, rectangles, optimise-tilt) are PASS-THROUGH layout knobs \u2014 each has its own `val-*` output to wire into Inset / Split / Optimise Rectangle downstream, so one calculator can drive a whole layout.\n\nTIP: wire a plot Space in; read FSI BUA to size massing (e.g. BUA \xF7 footprint \u2192 floors via a Math node).",
  handles: {
    input: true,
    output: true,
    valueOutputs: [
      { key: "fsiBua", label: "FSI BUA", unit: "m\xB2" },
      { key: "nonFsiBua", label: "Non-FSI BUA", unit: "m\xB2" }
    ]
  },
  parameters: [
    { key: "amenityOsRate", label: "Amenity OS Rate", kind: "number", default: 0.1, min: 0, max: 1, step: 0.01 },
    { key: "losRate", label: "LOS Rate", kind: "number", default: 0.15, min: 0, max: 1, step: 0.01 },
    { key: "basicFsiMultiplier", label: "Basic FSI", kind: "number", default: 1, min: 0, step: 0.1 },
    { key: "premiumFsiMultiplier", label: "Premium FSI", kind: "number", default: 0.5, min: 0, step: 0.1 },
    { key: "tdrMultiplier", label: "TDR FSI", kind: "number", default: 0.9, min: 0, step: 0.1 },
    { key: "fungibleRate", label: "Fungible Rate", kind: "number", default: 0.35, min: 0, max: 1, step: 0.05 },
    { key: "schemeFsiSqm", label: "Scheme FSI (m\xB2)", kind: "number", default: 11721.6, min: 0, step: 10 },
    { key: "inSituFsiFactor", label: "In-Situ FSI (\xD7)", kind: "number", default: 2, min: 0, step: 0.5 },
    { key: "carParksRequired", label: "Car Parks (nos)", kind: "number", default: 417, min: 0, step: 1 },
    { key: "areaPerCarParkSqm", label: "Area/Car Park (m\xB2)", kind: "number", default: 30, min: 0, step: 1 },
    { key: "otherNonFsiSqm", label: "Other Non-FSI (m\xB2)", kind: "number", default: 6e3, min: 0, step: 100 },
    { key: "wingsPerFloor", label: "Wings / Cores", kind: "number", default: 5, min: 1, step: 1 },
    { key: "podiumOffsetM", label: "Podium Offset (m)", kind: "number", default: 3.5, min: 0, step: 0.5, output: true },
    { key: "front", label: "Front offset", kind: "range", default: 0, min: 0, max: 6, step: 0.1, unit: "m", output: true },
    { key: "remaining", label: "Remaining offset", kind: "range", default: 0, min: 0, max: 6, step: 0.1, unit: "m", output: true },
    { key: "edgeIndex", label: "Edge index", kind: "range", default: 0, min: 0, max: 15, step: 1, output: true },
    { key: "ratio", label: "Ratio", kind: "text", default: "50, 50", placeholder: "10, 90", output: true },
    { key: "splitAngle", label: "Split Angle", kind: "range", default: 0, min: 0, max: 360, step: 1, unit: "\xB0", output: true },
    { key: "axisTilt", label: "Axis tilt", kind: "range", default: 0, min: 0, max: 360, step: 1, unit: "\xB0", output: true },
    { key: "rectangles", label: "Rectangles", kind: "range", default: 1, min: 1, max: 5, step: 1, output: true },
    { key: "optimiseAxisTilt", label: "Optimise axis tilt", kind: "checkbox", default: false, output: true }
  ]
};

// src/floorplan/flow/declarations/math.node.json
var math_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "math",
  meta: {
    label: "Math",
    category: "Calculate",
    color: "#ca8a04"
  },
  description: "result = A (op) B, optionally rounded. e.g. BUA \xF7 footprint, ceil = floors.",
  instructions: "A generic value calculator: `result = A <op> B`, optionally rounded. A and B come from wired value inputs (`valin-a` / `valin-b`) or the fallback fields when unwired. Publishes `val-result`.\n\nTIP: the classic use is FSI BUA \xF7 footprint area with round=ceil \u2192 number of floors (wire val-result into Massing's Floors). Chain Math nodes for multi-step arithmetic.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "a", label: "A" },
      { key: "b", label: "B" }
    ],
    valueOutputs: [
      { key: "result", label: "Result" }
    ]
  },
  parameters: [
    { key: "a", label: "A (if no input)", kind: "number", default: 0, step: 1 },
    { key: "b", label: "B (if no input)", kind: "number", default: 1, step: 1 },
    {
      key: "op",
      label: "Operation",
      kind: "select",
      default: "divide",
      options: [
        { value: "divide", label: "\xF7 Divide (A \xF7 B)" },
        { value: "multiply", label: "\xD7 Multiply" },
        { value: "add", label: "+ Add" },
        { value: "subtract", label: "\u2212 Subtract (A \u2212 B)" },
        { value: "min", label: "Min (smaller of A, B)" },
        { value: "max", label: "Max (larger of A, B)" }
      ]
    },
    {
      key: "round",
      label: "Round",
      kind: "select",
      default: "ceil",
      options: [
        { value: "none", label: "None" },
        { value: "ceil", label: "Ceil (round up)" },
        { value: "floor", label: "Floor (round down)" },
        { value: "round", label: "Nearest" }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/random.node.json
var random_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "random",
  meta: {
    label: "Random",
    category: "Calculate",
    color: "#9333ea"
  },
  description: "Random number in [min, max] with N decimals. Seeded (stable) \u2014 press Re-roll for a new draw.",
  instructions: "Emits a DETERMINISTIC pseudo-random number in [min, max], rounded to `decimals` places, on `val-result`. The draw is keyed on `seed` so the preview is stable and matches commit \u2014 press Re-roll to bump the seed for a fresh number. min/max are wireable (`valin-min` / `valin-max`).\n\nTIP: use it to vary layouts reproducibly \u2014 feed val-result into Optimise Rectangle's tilt/count, or a Split ratio.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "min", label: "Min" },
      { key: "max", label: "Max" }
    ],
    valueOutputs: [
      { key: "result", label: "Result" }
    ]
  },
  parameters: [
    { key: "min", label: "Min (if no input)", kind: "number", default: 0, step: 1 },
    { key: "max", label: "Max (if no input)", kind: "number", default: 10, step: 1 },
    { key: "decimals", label: "Decimal places", kind: "range", default: 0, min: 0, max: 6, step: 1 },
    { key: "seed", label: "Seed", kind: "number", default: 1, min: 1, step: 1 }
  ]
};

// src/floorplan/flow/declarations/expr.node.json
var expr_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "expr",
  meta: {
    label: "Math Engine",
    category: "Calculate",
    color: "#ca8a04"
  },
  description: "A formula over wired inputs \u2014 scalars AND matrices. Arithmetic overloads element-wise with broadcasting, `@` is the matrix product. Write several 'name = expr' lines to compute AND output multiple values from one node. A bounded `loop \u2026 end` adds iteration and accumulators; 2D and 3D BOOLEANS subtract, union and intersect.",
  instructions: "Evaluates through the safe expression engine (the same language as a pobj's `vars` / a declaration's `showWhen`).\n\nTWO MODES:\n\u2022 Single expression (e.g. `steps*tread`) \u2192 one output `val-result`.\n\u2022 A BLOCK of `name = expr` lines \u2192 one `val-<name>` output PER line, evaluated top-to-bottom so a later line can use an earlier name (a `vars` block). One Math Engine node then replaces a whole chain of Math / Conditional / Match \u2014 or Matrix / Vector \u2014 nodes.\n\u2022 `Algorithms.` holds whole named algorithms \u2014 `Q = Algorithms.Inset(P, 0.3)` offsets an outline with mitred corners instead of you rewriting the miter-vector maths each time. An algorithm is NOT a builtin: it is a body of this same language, so the node shows its maths in a read-only foldable block underneath the formula, and what you read there is exactly what ran. Paste it into your own body whenever you want to take it over and edit it.\n\u2022 Every built-in has a QUALIFIED NAME that reads as documentation: `Matrix.Transpose(A)`, `Vector.Dot(a, b)`, `Reduce.Sum(M)`, `Compare.Greater(A, B)`, `Shape.Union(A, B)`, `Solid.Prism(ring, 0, h)`. Type two letters and the editor offers the matching functions with their full signature, what each argument means and an example. The BARE names (`T`, `dot`, `sum`, `gt`, `union`, `mprism`) remain valid forever and mean exactly the same thing \u2014 the qualified form is an alias, so old and new can sit in one body.\n\u2022 A line starting with # is a SECTION MARKER: `# Winding test` opens a foldable region that runs until the next marker, so a long body reads as named sections you can fold shut instead of one wall of algebra. Purely presentational \u2014 the engine ignores # lines entirely, so adding or removing them cannot change a single output. Fold state travels with a saved flow, so a library workflow can ship folded.\n\u2022 A name starting with `_` is INTERNAL SCRATCH: it lives in the scope exactly like any other definition \u2014 later lines read it, a loop accumulates into it \u2014 but it publishes NO `val-` endpoint and never reaches a wire. A ported algorithm runs to a hundred-odd definitions, most of them pairwise N\xD7N work matrices; without this every one would add an output row to the node AND be JSON-stringified on every evaluation, i.e. on every slider drag. Name the steps worth inspecting, `_` the rest \u2014 Workflows/Operations/straight_skeleton_with_math.json publishes 28 of its 141.\n\nINPUTS \u2014 combinable:\n\u2022 Every INPUT variable (a free variable not defined by an earlier line) gets its own `valin-<var>` endpoint.\n\u2022 The static `deps` endpoint merges a whole Parametric Object / Input Properties node's values into scope by name in ONE wire.\nAn explicit `valin-<var>` wire OVERRIDES deps.\n\nLOOPS: `loop <var> in <count>:` \u2026 `end` re-runs the block with <var> bound to 0\u2026count\u22121. `end` is explicit rather than indentation-significant, so a body survives reformatting, and loops nest. Two things this makes possible:\n\u2022 an ACCUMULATOR that grows across iterations \u2014 seed it before the loop (`A = zeros(0,2)`) then `A = vcat(A, part)` inside. An EMPTY operand is the identity for vcat / hcat, so an iteration that produces nothing leaves the accumulator alone instead of wiping it.\n\u2022 `row(M, <var>)` as a GATHER by a computed index, which constant indexing could not do.\n\u2022 a WORK LIST, which is how RECURSION is expressed: keep the items in ONE flat matrix with an id column (`W = hcat(V, zeros(n,1))`), take one per pass (`sv = eq(col(W,2), p)`, `compress` for the item and `compress(W, 1-sv)` for the rest), and write any replacements back with new ids. Ragged sub-lists of different lengths then live in a single accumulator, and a divide-and-conquer recursion becomes a flat loop whose bound follows from the input size. To slice a CYCLIC range out of a ring in order, rotate first \u2014 `shift(V, 0 - i)` re-bases the ring on element i, after which the two halves are ordinary `sub(...)` slices; a row MASK cannot do it, because compress returns rows in index order and a range that wraps past 0 comes back scrambled. See Workflows/Operations/convex_decomposition_with_math.json.\n\u2022 a BEST-SO-FAR (an argmin/argmax over a swept parameter): `B = v < best ? cand : B` then `best = min(best, v)`, in that ORDER \u2014 the candidate is compared against the OLD best. Swapped, the test never fires and the sweep returns its first candidate. See Workflows/Operations/bounding_ngon_with_math.json.\n\u2022 an ARGMIN over a whole i\xD7j TABLE, not just a column: build the index matrix once (`IDX = k * m + T(k)`, k = arange(m)) and read the winner as a LINEAR index, `l = min(where(le(TS, min(TS)), IDX, BIG))`, which floor(l / m) and l \u2212 m * floor(l / m) split back into the pair. That is what makes a PAIRWISE search \u2014 every reflex vertex against every edge \u2014 one broadcast expression: put the i-quantities in columns and the j-quantities in rows with T(...), and the whole table of candidate times, hit points and validity masks builds at once. See Workflows/Operations/straight_skeleton_with_math.json.\n\u2022 a GATHER by a computed index for EVERY row at once, which `row(M,i)` can only do one row per loop pass: a gather is a permutation and a permutation is a MATRIX, so `eq(idx, T(k)) @ M` returns M's rows reordered by the column `idx` in a single product. That is what turns \"read each item's NEIGHBOUR\" into one line \u2014 and applied to an index column carried through a `sortby`, it is also how you get back to the original order afterwards. With the same pairwise machinery, `min(where(le(D2, tol*tol), T(k), BIG), 'rows')` gives coincident points a canonical id (a poor man's spatial hash) and the same table summed is each point's multiplicity. See Workflows/Operations/mitered_join_with_math.json, which needs all three to walk a graph with no ids in it.\n<var> is internal \u2014 it never becomes a `valin-` endpoint \u2014 while anything the COUNT expression reads IS a real input, so `loop i in rows(S)` takes its bound from the wired list. A name assigned inside a loop publishes its value after the FINAL iteration, or 0 if the loop ran zero times. BOUNDED: 10,000 iterations per loop and 200,000 statement evaluations per body, after which evaluation stops where it is \u2014 a mistyped count gives a wrong picture, never a hung tab. An unclosed `loop` closes at the end of the body and a stray `end` is ignored, so a half-typed block still evaluates while you edit.\nACCURACY, with a loop: the single-pass promise below does NOT hold \u2014 every element-wise result quantises to 1e-6 and that error accumulates across iterations (Workflows/Operations/voronoi_with_math.json measures 0.12 mm worst case over 7,240 vertices).\nNOT BAKEABLE: a parametric object's `vars` block is single-pass, so \"Save as Parametric Object\" refuses a body containing a loop and tells you, rather than copying the loop's lines as if they ran once.\n\nLANGUAGE: + - * / % ^, @, comparisons, == != (on 'strings' too \u2014 `config == 'u-shape'`), && || !, cond ? a : b, PI. Numbers may be written in scientific notation (`1e-9`).\n\nMATRICES ARE VALUES. A wire carries a matrix as JSON text, and anything that parses as a rectangular row-major array is lifted into a real matrix \u2014 so `val-points` from Space Geometry / Polygon / Vertices, or any Matrix node's `val-matrix`, wires straight into a variable. An N\xD72 matrix IS a list of N 2D vectors; there is no separate vector type.\n\u2022 `+ - * / % ^` are ELEMENT-WISE with numpy broadcasting (each dimension must match or be 1, so N\xD72 combines with N\xD71 per-row or with a 1\xD71 scalar).\n\u2022 `@` is the matrix product A\xB7B.\n\u2022 `^` is element-wise POWER, so `A^-1` is the reciprocal of every cell. The matrix inverse is `inv(A)`; prefer `solve(K,F)`, which is better-conditioned.\nA matrix used where a number is expected (a comparison, a numeric param) reads its [0][0] cell \u2014 the same bridge the nodes' `val-value` output uses.\n\nFUNCTIONS\n\u2022 algebra \u2014 T(A) transpose, inv(A), solve(K,F), kron(A,B), rows(A), cols(A)\n\u2022 row-wise vectors \u2014 shift(M,k) cyclic roll of the ROW ORDER (\u22121 = next neighbour, +1 = previous), or shift(M,k,'cols') to roll ALONG each row (so a sorted row minus its own shift is that row's gap list), normalize(M), perp(M) / perpcw(M), len(M), dot(a,b), cross(a,b), angle(v) or angle(a,b)\n\u2022 reductions \u2014 sum / mean / prod / min / max, with an optional axis: `sum(M)` folds everything to a plain NUMBER (so it can drive an ordinary numeric param), `sum(M,'rows')` \u2192 N\xD71, `sum(M,'cols')` \u2192 1\xD7C\n\u2022 constructors (a matrix of a WIRED size \u2014 no node can make one) \u2014 eye(n), zeros(r[,c]), ones(r[,c]), fill(r,c,v), arange(n) or arange(a,b), diag(v) both ways\n\u2022 order / selection \u2014 the operations that change a list's ORDER and its LENGTH. sort(M[,'rows'|'cols']) sorts the values INSIDE each row / column; sortby(M,key) permutes the ROWS by a key column, so a whole point travels with its key \u2014 `sortby(P, angle(P - c))` is the CCW ring of a cloud and `sortby(P,0)` the lexicographic-by-x sweep; compress(M,mask) keeps the rows whose mask cell is non-zero, the one operation whose OUTPUT ROW COUNT is data; where(mask,A,B) is the element-wise ternary\n\u2022 element-wise comparison \u2014 gt lt ge le eq ne, each returning a 0/1 mask of the broadcast shape, which is what compress / where eat. A product of masks is their AND, a sum clamped with min(...,1) their OR. `eq` against an index column is how \"skip the entries incident to i\" becomes a matrix. The comparison OPERATORS are deliberately NOT overloaded: `<` and `>` still read a matrix's [0][0] cell, because every showWhen gate and every ternary depends on a comparison yielding a scalar boolean.\n\u2022 slice / concat / reshape \u2014 sub(M,r0,c0,nr,nc), row(M,i), col(M,j), hcat(A,B,\u2026), vcat(A,B,\u2026), reshape(M,r,c). hcat / vcat are VARIADIC \u2014 they take any number of operands and fold left \u2014 so assembling a wide per-instance table is one call: an N\xD76 axis-segment list for a Tube / Ring row is `hcat(x1,y1,z1,x2,y2,z2)`, not five nested pairs with the operands in the wrong visual order. An EMPTY operand is still the identity, so a loop accumulator is unaffected. Indices are constants unless a loop supplies one; reshape is row-major and its r/c MAY be computed, which makes it an interleave \u2014 an M\xD74 of [a|b] rows reshaped to (2M)\xD72 alternates a's row and b's row\n\u2022 BOOLEANS \u2014 the operations that REMOVE material, which no amount of construction can express. subtract(A,B), union(A,B), intersect(A,B), xor(A,B) on 2D shapes, each a ring list read EVEN-ODD in the format a 2D Render Polygon row draws: N\xD72 is one ring, N\xD73 groups one ring per run of the third column. The result always carries the group column, so an outer plus its holes survives onto a wire \u2014 that is how a hole becomes expressible at all, and `subtract(outline, sevenCircles)` is a flute's plan in one call. An empty B is the identity for all but intersect, and even then A comes back DISSOLVED, so `union(A, zeros(0,3))` merges a pile of overlapping pieces into one clean outline. inpoly(P,R) is the companion MASK \u2014 which rows of P fall inside R, even-odd \u2014 feeding compress / where, and it is how a surface gets TRIMMED without a mesh boolean at all.\n\u2022 3D BOOLEANS \u2014 msubtract(A,B), munion(A,B), mintersect(A,B) on the `[x,y,z,f]` FACE LIST a Polyhedron row reads, so a result wires straight into one and can be subtracted again. Every input face is triangulated first (a triangle is unconditionally planar and convex, which is what the splitter assumes), and a solid whose winding is globally inverted is detected and flipped. The output has T-junctions where a split had no matching neighbour \u2014 geometrically watertight, but not manifold; volumes come out exact.\n\u2022 SOLID CONSTRUCTORS, because a boolean needs solids and every other mesh in the system is made by a render row, i.e. downstream of the formula. mcyl(seg, r, sides[, rEnd]) is a closed cylinder \u2014 or a cone when the end radius differs \u2014 along an axis SEGMENT `[x1,y1,z1,x2,y2,z2]`, the same wire format the Tube and Ring rows read, so a drill is aimed with geometry already to hand. mprism(ring, z0, z1) extrudes any 2D outline into a closed solid, whichever way it was wound. mlathe(seg, profile, sides) REVOLVES a closed profile of `[t, r]` rows about the axis.\n\u2022 USE mlathe, NOT A SUBTRACTION, FOR ANYTHING HOLLOW. `msubtract(cylinder, longer cylinder)` is a poor case for BSP: a thin wall's facets straddle the bore's radial planes instead of sitting behind them, so each is split many times \u2014 measured at 3.5\xD7 / 3.9\xD7 / 4.5\xD7 the faces of the equivalent revolve at 32 / 48 / 64 sides. A profile is also the truer description: for a bansuri, `(head,0) \u2192 (head,R) \u2192 (foot,R) \u2192 (foot,rBore) \u2192 (cork,rBore) \u2192 (cork,0)` IS the outer surface, the foot annulus, the bore and the cork face, in six points a maker would recognise. Then spend the boolean on what only it can do \u2014 the holes \u2014 and subtract them as ONE cutter (`vcat` the drills, or accumulate them in a loop) rather than one call each: eight chained subtractions measured 116k triangles and 3.8 s where a revolve plus one boolean is 3.2k and 74 ms.\n\u2022 scalars \u2014 min max floor ceil round abs sqrt pow sin cos tan atan2 sign log log2 log10 exp; the logarithms are what invert `^`, so a ratio becomes an interval: 12\xB7log2(f/440) is a frequency in semitones, and equal temperament \u2014 hole positions on a flute, fret spacing \u2014 is `L / 2^(n/12)` one way and a log the other. `log` is natural and guards x\u22640 to 0 rather than \u2212Infinity, so one bad cell cannot poison a broadcast column; `sign` lifting element-wise is what vectorises an ORIENTATION test, and a segment-intersection predicate is four orientation signs compared with each other. There is no acos, but `angle(a,b)` is atan2(cross,dot) in degrees and its absolute value is the same unsigned angle; these LIFT element-wise the moment a matrix is passed, so `sin(arange(0,n) * PI / n)` is a source term that varies as a formula.\n\nEXAMPLE \u2014 the whole eleven-node inset chain (see Workflows/inset_using_maths_v2.json):\n  E  = shift(P,-1) - P\n  n  = perp(normalize(E))\n  np = shift(n, 1)\n  M  = (n + np) / (1 + dot(n, np))\n  Q  = P + inset * M\nWire `val-Q` into Polygon's `valin-points`. Each named line stays a separate output, so the intermediates are still inspectable.\n\nEXAMPLE \u2014 scalars, unchanged:\n  dir = direction == 'ltr' ? 1 : -1\n  run = steps * tread * dir\n  n1  = (midSteps>0 && midSteps<steps) ? midSteps : floor(steps/2)\n\nACCURACY: values stay live between lines and are rounded only when published, so a long chain rounds once \u2014 a matrix NODE chain rounds after every node.\n\nLIMITS: no indexing by a computed value OUTSIDE a loop \u2014 `row(M,i)` under a `loop i` is the gather; without one, a data-dependent ORDER or LENGTH is still expressible with sortby / compress (see Workflows/Operations/convex_hull_with_math.json, which drops and reorders points with no loop at all). `name` (the field) is just the node's header label.\n\nTHREE STAGES, NOT ONE. A Math Engine can DECODE before the formulas and ENCODE after them, which is the whole read-compute-write pipeline in one node. Both sections are blank by default and cost nothing when unused \u2014 an object's Math Engine is unchanged.\n\nDecode runs Graph Interpreter on a canvas payload and puts its matrices in scope BY NAME, so the body reads `types` and `spaces` as ordinary free variables and the wires disappear. Encode runs Canvas Encoder over what the body published and adds `val-json`.\n\nNeither hides anything: the decoded matrices are published as `val-` outputs exactly as the standalone node publishes them, so they stay inspectable and any other node can still read them. The standalone Graph Interpreter and Canvas Encoder nodes remain \u2014 they run this same code \u2014 and are still the right choice when a flow decodes twice, or decodes without computing anything.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "deps",
        label: "deps (whole params node)"
      }
    ],
    valueOutputs: [
      {
        key: "result",
        label: "Result (single-expression mode)"
      }
    ]
  },
  parameters: [
    {
      key: "name",
      label: "Name",
      kind: "text",
      default: ""
    },
    {
      key: "expr",
      label: "Formula(s)",
      kind: "textarea",
      default: "",
      placeholder: "one expression, OR several `name = expr` lines \u2014 start a line with # to open a foldable section",
      sections: true
    },
    {
      key: "decode",
      kind: "textarea",
      rows: 4,
      label: "canvas JSON in \u2014 config, blank = off",
      default: "",
      help: "Runs Graph Interpreter BEFORE the formulas and puts its matrices in scope by name - a, b, thickness, length, types, spaces, areas, plus nodes, nodeTypes, segNodes and the per-element object parameters - so the body reads them as free variables with no wires. `from` names the scope key holding the payload (default canvasJson); `typeNames` is the code table; `nodeParams` / `segParams` name the parameter keys to lift off each element's attached object (published as nodeVals/nodeHas and segVals/segHas). The matrices are published as val- outputs too, so nothing is hidden."
    },
    {
      key: "encode",
      kind: "textarea",
      rows: 4,
      label: "plan JSON out \u2014 config, blank = off",
      default: "",
      help: 'Runs Canvas Encoder AFTER the formulas and publishes val-json. `from` maps each encoder input to the name this body publishes it under \u2014 {"a": "AllA", "types": "AllK", \u2026}. `objects`, `pixelsPerMeter`, `libraryPath` and `decimals` are the encoder\'s own settings.'
    }
  ]
};

// src/floorplan/flow/declarations/file-upload.node.json
var file_upload_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "file-upload",
  meta: {
    label: "File Upload",
    category: "Calculate",
    color: "#2563eb"
  },
  description: "Pick a file (OS open dialog) \u2192 outputs its path (val-path) and data URL (val-data, e.g. for Analyse).",
  instructions: "Pick a file from disk via the OS open dialog (the picker UI is rendered by the app). Publishes the chosen file's name on `val-path` (browsers don't expose the absolute path) and its data URL (`data:<mime>;base64,\u2026`) on `val-data`.\n\nTIP: wire `val-data` into an Analyse node's File input to send the bytes to Gemini; wire `val-path` into an Output / Text node to record the filename. The data URL is transient (not written into saved flows).",
  handles: {
    input: false,
    output: false,
    valueOutputs: [
      { key: "path", label: "Path" },
      { key: "data", label: "Data" }
    ]
  },
  parameters: [],
  defaults: { path: "", fileName: "" }
};

// src/floorplan/flow/declarations/text.node.json
var text_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "text",
  meta: {
    label: "Text",
    category: "Calculate",
    color: "#475569"
  },
  description: "A text value \u2014 type it, or pass one in (valin-text); outputs it on val-text.",
  instructions: "A text value node \u2014 type a string, or wire a `val-*` string into `valin-text` to override it. Re-publishes the resolved string on `val-text` for downstream value consumers or the Output node. No geometry.\n\nTIP: use it to label outputs, build captions, or pass a prompt / string through a flow.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "text", label: "Text in" }
    ],
    valueOutputs: [
      { key: "text", label: "Text" }
    ]
  },
  parameters: [
    { key: "text", label: "Text", kind: "textarea", default: "", placeholder: "Type text\u2026 (or wire an input)" }
  ]
};

// src/floorplan/flow/declarations/prompt-builder.node.json
var prompt_builder_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "prompt-builder",
  meta: {
    label: "Prompt Builder",
    category: "AI",
    color: "#7c3aed"
  },
  description: "Fill a text TEMPLATE with values wired in from the flow \u2014 `{area}`, `{doorWidth}` \u2014 and publish the result on `val-text`. The bridge from measured numbers to a written prompt.",
  instructions: "The missing step between a flow's NUMBERS and a model's WORDS.\n\nEverything else in the value plane speaks numbers: the Math Engine broadcasts them, Output Metrics collects them, Get Object Param reads them off an attached object. But the Render and Analyse nodes want a SENTENCE, and nothing could turn one into the other \u2014 the Math Engine has no string concatenation, and the Text node only passes a string through unchanged. This node is that step.\n\nHOW IT WORKS. Type a template with `{name}` placeholders. Each value input has a NAME field; wire a value into `Value 1` and call it `area`, and every `{area}` in the template is replaced by what arrived on that wire. The filled text leaves on `val-text` \u2014 wire it into the Render node's `Prompt`, or into Analyse, or into an Output slot to read it.\n\nWHY TEN NAMED SLOTS rather than an endpoint per placeholder. The endpoints are STATIC, so the node's shape never changes as you type \u2014 a half-written `{` cannot detach a wire you already made, which is exactly what a dynamic-endpoint node does while you edit its template. Ten covers a room schedule with room to spare; wire a Math Engine's matrix into one slot if you need more figures than that in one go.\n\nA NUMBER IS FORMATTED, not dumped: `Decimals` rounds every numeric substitution, so `{area}` reads \"17.9\" rather than \"17.899999999999999\". Strings pass through untouched.\n\nAN UNWIRED OR UNNAMED SLOT SUBSTITUTES NOTHING \u2014 its placeholder is left in the text verbatim, so `{doorWidth}` staying visible in the output is the node telling you that wire is missing. That is deliberate: silently emptying it would send a model a sentence with a hole in it and no way to notice.\n\nA placeholder with no matching slot name is likewise left alone, so ordinary prose containing braces survives.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "v1",
        label: "Value 1"
      },
      {
        key: "v2",
        label: "Value 2"
      },
      {
        key: "v3",
        label: "Value 3"
      },
      {
        key: "v4",
        label: "Value 4"
      },
      {
        key: "v5",
        label: "Value 5"
      },
      {
        key: "v6",
        label: "Value 6"
      },
      {
        key: "v7",
        label: "Value 7"
      },
      {
        key: "v8",
        label: "Value 8"
      },
      {
        key: "v9",
        label: "Value 9"
      },
      {
        key: "v10",
        label: "Value 10"
      }
    ],
    valueOutputs: [
      {
        key: "text",
        label: "Text"
      }
    ]
  },
  parameters: [
    {
      key: "template",
      label: "Template",
      kind: "textarea",
      rows: 8,
      default: "",
      placeholder: "A {roomType} of {area} m\xB2, {dimX} \xD7 {dimY} m\u2026"
    },
    {
      key: "n1",
      label: "Value 1 name",
      kind: "text",
      default: "",
      placeholder: "e.g. area"
    },
    {
      key: "n2",
      label: "Value 2 name",
      kind: "text",
      default: "",
      placeholder: "e.g. perimeter"
    },
    {
      key: "n3",
      label: "Value 3 name",
      kind: "text",
      default: "",
      placeholder: "e.g. dimX"
    },
    {
      key: "n4",
      label: "Value 4 name",
      kind: "text",
      default: "",
      placeholder: "e.g. dimY"
    },
    {
      key: "n5",
      label: "Value 5 name",
      kind: "text",
      default: ""
    },
    {
      key: "n6",
      label: "Value 6 name",
      kind: "text",
      default: ""
    },
    {
      key: "n7",
      label: "Value 7 name",
      kind: "text",
      default: ""
    },
    {
      key: "n8",
      label: "Value 8 name",
      kind: "text",
      default: ""
    },
    {
      key: "n9",
      label: "Value 9 name",
      kind: "text",
      default: ""
    },
    {
      key: "n10",
      label: "Value 10 name",
      kind: "text",
      default: ""
    },
    {
      key: "decimals",
      label: "Decimals",
      kind: "range",
      default: 2,
      min: 0,
      max: 6,
      step: 1
    }
  ]
};

// src/floorplan/flow/declarations/plan-json.node.json
var plan_json_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "plan-json",
  meta: {
    label: "Plan JSON",
    category: "Canvas",
    color: "#0f766e"
  },
  description: "The canvas as JSON \u2014 the selected Space's outline, the segments and nodes inside it, and the parametric object plus resolved parameters attached to each. A ROOT: it reads the canvas itself, so nothing is wired into it. Publishes on `val-json`. SUPERSEDED: the Geometry node now publishes the same payload on `val-canvasJson`, so new flows need one node where this took two. Kept so every saved flow that already holds one keeps loading and evaluating exactly as it did.",
  instructions: 'SUPERSEDED BY THE GEOMETRY NODE, which carries this payload on its own `val-canvasJson` output \u2014 one node for the shape AND the model behind it, instead of a pair that could disagree about what the selection was. This node is kept, unchanged, so existing flows keep working; it is no longer offered in the Add-node list.\n\nThe bridge from the canvas MODEL to a wire, and a ROOT \u2014 it reads the canvas directly, so it has NO geometry input. Its one value input is optional: wire a number into Catchment buffer to drive that slider from elsewhere, or leave it unwired and use the slider.\n\nONE NODE, FOUR ANSWERS. It used to take two nodes to ask the canvas anything \u2014 a Geometry node for the shape and this one for the data \u2014 and they could disagree about what "the selection" meant. Now the target is resolved once and published every way at once:\n\u2022 a NODE selected (or its id typed) \u2192 `val-points` is ONE point `[[x,y]]`,\n\u2022 a SEGMENT \u2192 its two endpoints `[[x1,y1],[x2,y2]]`,\n\u2022 a SPACE \u2192 its outline, one [x, y] pair per vertex,\n\u2022 NOTHING selected \u2192 no points, and `val-json` carries the WHOLE canvas.\n`val-kind` says which of the four you got ("node" / "segment" / "space" / "canvas"), so a flow can branch on it instead of guessing from the row count. The resolved target also leaves the GEOMETRY output on the right, so it feeds Filter by Space, Snapshot, Render or any op directly \u2014 no Vertices or Polygon hop to turn a list back into a shape.\n\nPRECEDENCE, when more than one thing could answer: a SPACE wins over a segment, a segment over a node, and anything over the whole canvas. That mirrors the canvas\'s own Select scope, which already makes node and segment mutually exclusive. Ids are resolved the same way \u2014 space first, then segment, then node \u2014 so a typed id that exists in two tables resolves as the larger thing, and `val-kind` tells you which it picked rather than leaving you to infer it.\n\nSCOPE OF THE JSON. With Grab from selection ON it follows the canvas: select a Space and the payload narrows to that room; select nothing and you get the whole canvas. Turn the toggle off to pin a target by id. Scoping is the point \u2014 a render prompt for one bedroom should not carry the other eleven rooms.\n\nThe GEOMETRY and the JSON are independent on purpose. A flow that wants the selection as its region AND the whole canvas as its payload \u2014 the shape Filter by Space is built for \u2014 turns Grab from selection OFF, types no id, and still gets the live selection on `val-points` and on the geometry output.\n\nWHAT IS INSIDE the JSON. A node counts when its point is inside the outline. A segment counts when its MIDPOINT is inside, or within Catchment buffer of the boundary \u2014 because the walls that BOUND a room lie ON its outline, and a point exactly on the edge is undefined under even-odd ray casting, so a strict test keeps some bounding walls and drops others depending on the room\'s coordinates. The tolerance is what makes the answer deterministic. It is ALSO the catchment: applied to nodes as well as segments, so 2 m is exactly "everything within 2 m of this room". Small values (0.15) mean strictly this room.\n\nWHAT COMES OUT, as one JSON object on `val-json`:\n\u2022 `space` \u2014 the outline (anchor-relative metres), its area, and the attached object\'s `objectId` + resolved `params`.\n\u2022 `segments` \u2014 one entry each: `id`, `type` (wall / door / window \u2014 the fact no attachment carries), the two endpoints, length, thickness, and the attached object\'s id + params when there is one.\n\u2022 `nodes` \u2014 one entry each: `id`, position, and the attached object\'s id + params.\nParameters are the object\'s DEFAULTS with that instance\'s overrides on top, so a parameter added to a definition after the object was placed still reports \u2014 the same merge Filter by Type and Grab Object use. That is also how each object\'s `semantics` reaches the wire.\n\nDEFINITIONS ARE NOT INCLUDED, only references. That is the same decision the canvas\'s own JSON export made and for the same measured reason: on a 23-plot layout the two object definitions came to 15.9 KB against 4.6 KB for all 24 attachments put together. A model needs to know a Door object is on this segment and how wide its leaf is; it does not need the maths body that draws one.\n\nMETRES, anchor-relative \u2014 the shared frame every other value output speaks.\n\nWIRE IT INTO a Prompt Builder slot (it substitutes as text like any other value), an Output slot to read it, or Filter by Space\'s `json` when the region is decided elsewhere in the flow.',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "edgeTolerance",
        label: "Catchment buffer"
      }
    ],
    valueOutputs: [
      {
        key: "json",
        label: "Plan (JSON)"
      },
      {
        key: "spaceCount",
        label: "Spaces"
      },
      {
        key: "segmentCount",
        label: "Segments"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "objectCount",
        label: "Attached objects"
      },
      {
        key: "bytes",
        label: "JSON size",
        unit: "B"
      }
    ]
  },
  parameters: [
    {
      key: "grabFromSelection",
      label: "Grab from selection",
      kind: "checkbox",
      default: true
    },
    {
      key: "id",
      label: "Space ID",
      kind: "text",
      default: "",
      placeholder: "e.g. Space001 \u2014 blank = whole canvas",
      showIf: {
        when: "grabFromSelection",
        equals: false
      }
    },
    {
      key: "edgeTolerance",
      label: "Catchment buffer",
      kind: "range",
      default: 0.15,
      min: 0,
      max: 5,
      step: 0.01,
      unit: "m"
    },
    {
      key: "includeParams",
      label: "Include object parameters",
      kind: "checkbox",
      default: true
    },
    {
      key: "includeNodes",
      label: "Include nodes",
      kind: "checkbox",
      default: true
    },
    {
      key: "decimals",
      label: "Decimals",
      kind: "range",
      default: 3,
      min: 0,
      max: 6,
      step: 1
    }
  ],
  defaults: {
    grabFromSelection: true,
    id: "",
    edgeTolerance: 0.15,
    includeParams: true,
    includeNodes: true,
    decimals: 3
  }
};

// src/floorplan/flow/declarations/filter-by-space.node.json
var filter_by_space_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "filter-by-space",
  meta: {
    label: "Filter by Space",
    category: "Canvas",
    color: "#0f766e"
  },
  description: "Narrow a Plan JSON payload to ONE space. Takes the space's outline on its geometry input and a Plan JSON string on `json`, grows the outline by Margin, and republishes only the spaces, segments and nodes that fall inside \u2014 with their attached objects. Publishes on `val-json`.",
  instructions: "The scoping half of Plan JSON, split out so the SHAPE and the PAYLOAD can be decided separately.\n\nPlan JSON scopes itself to the canvas SELECTION, which is convenient and inflexible: nothing else can choose the region, and the region cannot be grown, computed or reused. Wire Plan JSON with nothing selected \u2014 so it emits the WHOLE canvas \u2014 then feed it through this node with any Space on the geometry input, and the region becomes ordinary flow geometry: a selected room, an Inset of it, a Bounding Shape, a Math Engine's result. The filter reads the wired outline's VERTICES, so whatever produced them is irrelevant.\n\nINPUTS\n\u2022 GEOMETRY (left) \u2014 the outline to filter by. Several wired in are treated as one region: an entry is kept if it falls inside ANY of them.\n\u2022 `json` \u2014 a Plan JSON string, normally straight off Plan JSON's `val-json`.\n\nMARGIN is an outward offset on that outline, in metres, and it is the setting that decides whether a room arrives complete. The walls that BOUND a room lie exactly ON its outline, and a point on the edge is undefined under even-odd ray casting \u2014 it lands inside or outside depending on which way the ray happens to cross. A margin of zero therefore keeps some of a room's own walls and drops others, and WHICH ones changes with the room's coordinates. Anything from about 0.15 m up is deterministic; the default 1 m also catches a door leaf swinging out, a window reveal and furniture pushed against the far face of a wall. Grow it further to pull in the neighbouring context a render benefits from, and watch the counts: past a metre or two you are collecting other rooms.\n\nWHAT IS TESTED, per entry:\n\u2022 a SPACE by its centroid,\n\u2022 a SEGMENT by its midpoint \u2014 so a wall shared by two rooms belongs to both, which is what a render of either one needs,\n\u2022 a NODE by its point.\n\nATTACHED OBJECTS ONLY narrows the result to entries carrying an `objectId` \u2014 the nodes and segments that have a parametric object on them, and nothing else. That is the subset a render actually draws from: the door with its leaf and handle, the window with its reveal, the furniture. Leave it off to keep the plain walls too, which is what gives the model the room's shape.\n\nOUTPUT `val-json` is the same payload shape Plan JSON emits, so anything that consumed one consumes the other \u2014 the Render node's Prompt above all. `space` is replaced by the wired outline (with its own attachment, when the outline matches a canvas space), and `scoped` is true. The counts beside it are the diagnostic: if Attached objects reads 0, either nothing in range carries an object or the Margin is too tight, and the counts say which.\n\nIt draws nothing and threads no geometry onward \u2014 the wired outline is a QUESTION, not something this node produces.\n\nTHE REGION CAN ARRIVE AS A LIST. `valin-points` takes the outline as `[[x,y],\u2026]` in metres \u2014 a Geometry node's `val-points`, an Input Properties text parameter carrying it, a Math Engine's result \u2014 and is used exactly as a wired outline is. The GEOMETRY input still works and still WINS when both are connected; the list is there so a flow that already passes the outline around as a value does not need a second, parallel geometry wire to say the same thing twice.",
  handles: {
    input: true,
    output: false,
    valueInputs: [
      {
        key: "points",
        label: "Region (points)"
      },
      {
        key: "json",
        label: "Plan (JSON)"
      },
      {
        key: "margin",
        label: "Margin"
      }
    ],
    valueOutputs: [
      {
        key: "json",
        label: "Plan (JSON)"
      },
      {
        key: "margin",
        label: "Margin",
        unit: "m"
      },
      {
        key: "spaceCount",
        label: "Spaces"
      },
      {
        key: "segmentCount",
        label: "Segments"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "objectCount",
        label: "Attached objects"
      },
      {
        key: "bytes",
        label: "JSON size",
        unit: "B"
      }
    ]
  },
  parameters: [
    {
      key: "margin",
      label: "Margin",
      kind: "range",
      default: 1,
      min: 0,
      max: 20,
      step: 0.05,
      unit: "m"
    },
    {
      key: "objectsOnly",
      label: "Attached objects only",
      kind: "checkbox",
      default: false
    },
    {
      key: "includeNodes",
      label: "Include nodes",
      kind: "checkbox",
      default: true
    },
    {
      key: "decimals",
      label: "Decimals",
      kind: "range",
      default: 3,
      min: 0,
      max: 6,
      step: 1
    }
  ],
  defaults: {
    margin: 1,
    objectsOnly: false,
    includeNodes: true,
    decimals: 3
  }
};

// src/floorplan/flow/declarations/cuboid.node.json
var cuboid_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "cuboid",
  meta: { label: "Cuboid", category: "3d primitives", color: "#0e7490" },
  description: "3D primitive \u2014 a Length \xD7 Breadth \xD7 Height cuboid at Position (X/Y/Z, base on the floor at Y=0), with its own Rotation and Scale. Wire into Display 3D for colour / style; add Transform 3D to compose / mirror.",
  instructions: "A 3D primitive source \u2014 a Length \xD7 Breadth \xD7 Height box with its base on the floor plane (Y=0 is the floor, Y is up), positioned / rotated / scaled by the Position, Rotate and Scale params. It has no input; it renders in the 3D view. Wire its output into Display 3D to set colour / opacity / wireframe, into Transform 3D to compose or mirror, or into Boolean for CSG.\n\nNOTE: the primitive carries no colour of its own \u2014 style it with a downstream Display 3D node.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      { key: "length", label: "Length" },
      { key: "breadth", label: "Breadth" },
      { key: "height", label: "Height" },
      { key: "posX", label: "Position X" },
      { key: "posY", label: "Position Y" },
      { key: "posZ", label: "Position Z" },
      { key: "rotX", label: "Rotate X" },
      { key: "rotY", label: "Rotate Y" },
      { key: "rotZ", label: "Rotate Z" },
      { key: "scale", label: "Scale" },
      { key: "show", label: "Show" }
    ]
  },
  parameters: [
    { key: "length", label: "Length", kind: "range", default: 3, min: 0.1, max: 50, step: 0.1, unit: "m" },
    { key: "breadth", label: "Breadth", kind: "range", default: 2, min: 0.1, max: 50, step: 0.1, unit: "m" },
    { key: "height", label: "Height", kind: "range", default: 3, min: 0.1, max: 50, step: 0.1, unit: "m" },
    { key: "posX", label: "Position X", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posY", label: "Position Y (up)", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posZ", label: "Position Z", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "rotX", label: "Rotate X", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotY", label: "Rotate Y", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotZ", label: "Rotate Z", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "scale", label: "Scale", kind: "range", default: 1, min: 0.1, max: 5, step: 0.05 },
    { key: "show", label: "Show", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/cylinder.node.json
var cylinder_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "cylinder",
  meta: { label: "Cylinder", category: "3d primitives", color: "#0e7490" },
  description: "3D primitive \u2014 a Cylinder of the given Radius and Height at Position (X/Y/Z, base on the floor at Y=0), with its own Rotation and Scale. Wire into Display 3D for colour / style; add Transform 3D to compose / mirror.",
  instructions: "A 3D primitive source \u2014 a Radius \xD7 Height cylinder with its base on the floor plane (Y=0 is the floor, Y is up), positioned / rotated / scaled by the Position, Rotate and Scale params. No input; it renders in the 3D view. Wire its output into Display 3D for colour / style, Transform 3D to compose or mirror, or Boolean for CSG.\n\nNOTE: the primitive carries no colour of its own \u2014 style it with a downstream Display 3D node.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      { key: "radius", label: "Radius" },
      { key: "height", label: "Height" },
      { key: "posX", label: "Position X" },
      { key: "posY", label: "Position Y" },
      { key: "posZ", label: "Position Z" },
      { key: "rotX", label: "Rotate X" },
      { key: "rotY", label: "Rotate Y" },
      { key: "rotZ", label: "Rotate Z" },
      { key: "scale", label: "Scale" },
      { key: "show", label: "Show" }
    ]
  },
  parameters: [
    { key: "radius", label: "Radius", kind: "range", default: 1.5, min: 0.1, max: 25, step: 0.1, unit: "m" },
    { key: "height", label: "Height", kind: "range", default: 3, min: 0.1, max: 50, step: 0.1, unit: "m" },
    { key: "posX", label: "Position X", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posY", label: "Position Y (up)", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posZ", label: "Position Z", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "rotX", label: "Rotate X", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotY", label: "Rotate Y", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotZ", label: "Rotate Z", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "scale", label: "Scale", kind: "range", default: 1, min: 0.1, max: 5, step: 0.05 },
    { key: "show", label: "Show", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/sphere.node.json
var sphere_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "sphere",
  meta: { label: "Sphere", category: "3d primitives", color: "#0e7490" },
  description: "3D primitive \u2014 a Sphere of the given Radius at Position (X/Y/Z, resting on the floor at Y=0), with its own Rotation and Scale. Wire into Display 3D for colour / style; add Transform 3D to compose / mirror.",
  instructions: "A 3D primitive source \u2014 a Sphere of the given Radius, resting on the floor plane (Y=0 is the floor, Y is up), positioned / rotated / scaled by the Position, Rotate and Scale params. No input; it renders in the 3D view. Wire its output into Display 3D for colour / style, Transform 3D to compose or mirror, or Boolean for CSG.\n\nNOTE: the primitive carries no colour of its own \u2014 style it with a downstream Display 3D node.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      { key: "radius", label: "Radius" },
      { key: "posX", label: "Position X" },
      { key: "posY", label: "Position Y" },
      { key: "posZ", label: "Position Z" },
      { key: "rotX", label: "Rotate X" },
      { key: "rotY", label: "Rotate Y" },
      { key: "rotZ", label: "Rotate Z" },
      { key: "scale", label: "Scale" },
      { key: "show", label: "Show" }
    ]
  },
  parameters: [
    { key: "radius", label: "Radius", kind: "range", default: 1.5, min: 0.1, max: 25, step: 0.1, unit: "m" },
    { key: "posX", label: "Position X", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posY", label: "Position Y (up)", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posZ", label: "Position Z", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "rotX", label: "Rotate X", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotY", label: "Rotate Y", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotZ", label: "Rotate Z", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "scale", label: "Scale", kind: "range", default: 1, min: 0.1, max: 5, step: 0.05 },
    { key: "show", label: "Show", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/cone.node.json
var cone_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "cone",
  meta: { label: "Cone", category: "3d primitives", color: "#0e7490" },
  description: "3D primitive \u2014 a Cone of the given Radius and Height at Position (X/Y/Z, base on the floor at Y=0), with its own Rotation and Scale. Wire into Display 3D for colour / style; add Transform 3D to compose / mirror.",
  instructions: "A 3D primitive source \u2014 a Radius \xD7 Height cone with its base on the floor plane (Y=0 is the floor, Y is up), positioned / rotated / scaled by the Position, Rotate and Scale params. No input; it renders in the 3D view. Wire its output into Display 3D for colour / style, Transform 3D to compose or mirror, or Boolean for CSG.\n\nNOTE: the primitive carries no colour of its own \u2014 style it with a downstream Display 3D node.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      { key: "radius", label: "Radius" },
      { key: "height", label: "Height" },
      { key: "posX", label: "Position X" },
      { key: "posY", label: "Position Y" },
      { key: "posZ", label: "Position Z" },
      { key: "rotX", label: "Rotate X" },
      { key: "rotY", label: "Rotate Y" },
      { key: "rotZ", label: "Rotate Z" },
      { key: "scale", label: "Scale" },
      { key: "show", label: "Show" }
    ]
  },
  parameters: [
    { key: "radius", label: "Radius", kind: "range", default: 1.5, min: 0.1, max: 25, step: 0.1, unit: "m" },
    { key: "height", label: "Height", kind: "range", default: 3, min: 0.1, max: 50, step: 0.1, unit: "m" },
    { key: "posX", label: "Position X", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posY", label: "Position Y (up)", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "posZ", label: "Position Z", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "rotX", label: "Rotate X", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotY", label: "Rotate Y", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotZ", label: "Rotate Z", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "scale", label: "Scale", kind: "range", default: 1, min: 0.1, max: 5, step: 0.05 },
    { key: "show", label: "Show", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/frustum.node.json
var frustum_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "frustum",
  meta: {
    label: "Frustum",
    category: "3d primitives",
    color: "#0e7490"
  },
  description: "3D primitive \u2014 a tapered cylinder: Bottom Radius \u2192 Top Radius over Height, base on the floor at Y=0. Top radius 0 = a cone. Wire into Display 3D for colour; Transform 3D to compose.",
  instructions: "A FRUSTUM (tapered cylinder) \u2014 `radiusBottom` at the base tapering to `radiusTop` over `height` metres, base on the floor plane (Y=0, Y up). Top radius 0 \u21D2 a cone; equal radii \u21D2 a cylinder. The missing taper for sloped footings, tapered columns, hoppers, cooling-tower sections. All params wireable; colour via a downstream Display 3D.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "radiusBottom",
        label: "Bottom Radius"
      },
      {
        key: "radiusTop",
        label: "Top Radius"
      },
      {
        key: "height",
        label: "Height"
      },
      {
        key: "posX",
        label: "Position X"
      },
      {
        key: "posY",
        label: "Position Y (up)"
      },
      {
        key: "posZ",
        label: "Position Z"
      },
      {
        key: "rotX",
        label: "Rotate X"
      },
      {
        key: "rotY",
        label: "Rotate Y"
      },
      {
        key: "rotZ",
        label: "Rotate Z"
      },
      {
        key: "scale",
        label: "Scale"
      },
      {
        key: "show",
        label: "Show"
      }
    ]
  },
  parameters: [
    {
      key: "radiusBottom",
      label: "Bottom Radius",
      kind: "range",
      default: 1.5,
      min: 0.05,
      max: 25,
      step: 0.05,
      unit: "m"
    },
    {
      key: "radiusTop",
      label: "Top Radius",
      kind: "range",
      default: 0.8,
      min: 0,
      max: 25,
      step: 0.05,
      unit: "m"
    },
    {
      key: "height",
      label: "Height",
      kind: "range",
      default: 3,
      min: 0.1,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posX",
      label: "Position X",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posY",
      label: "Position Y (up)",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posZ",
      label: "Position Z",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "rotX",
      label: "Rotate X",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotY",
      label: "Rotate Y",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotZ",
      label: "Rotate Z",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "scale",
      label: "Scale",
      kind: "range",
      default: 1,
      min: 0.1,
      max: 5,
      step: 0.05
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ]
};

// src/floorplan/flow/declarations/tapered-box.node.json
var tapered_box_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "tapered-box",
  meta: {
    label: "Tapered Box",
    category: "3d primitives",
    color: "#0e7490"
  },
  description: "3D primitive \u2014 a rectangular frustum: Bottom Length \xD7 Breadth tapering to Top Length \xD7 Breadth over Height, base on the floor at Y=0. Wire into Display 3D for colour; Transform 3D to compose.",
  instructions: "A TAPERED BOX (rectangular frustum) \u2014 a `length` \xD7 `breadth` base tapering to `topLength` \xD7 `topBreadth` over `height` metres, base on the floor (Y=0, Y up), all faces flat. Top dims 0 \u21D2 a rectangular pyramid. Sloped/stepped footings, pyramid roofs, battered walls, pedestals. All params wireable; colour via Display 3D.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "length",
        label: "Bottom Length"
      },
      {
        key: "breadth",
        label: "Bottom Breadth"
      },
      {
        key: "topLength",
        label: "Top Length"
      },
      {
        key: "topBreadth",
        label: "Top Breadth"
      },
      {
        key: "height",
        label: "Height"
      },
      {
        key: "posX",
        label: "Position X"
      },
      {
        key: "posY",
        label: "Position Y (up)"
      },
      {
        key: "posZ",
        label: "Position Z"
      },
      {
        key: "rotX",
        label: "Rotate X"
      },
      {
        key: "rotY",
        label: "Rotate Y"
      },
      {
        key: "rotZ",
        label: "Rotate Z"
      },
      {
        key: "scale",
        label: "Scale"
      },
      {
        key: "show",
        label: "Show"
      }
    ]
  },
  parameters: [
    {
      key: "length",
      label: "Bottom Length",
      kind: "range",
      default: 3,
      min: 0.05,
      max: 50,
      step: 0.05,
      unit: "m"
    },
    {
      key: "breadth",
      label: "Bottom Breadth",
      kind: "range",
      default: 2,
      min: 0.05,
      max: 50,
      step: 0.05,
      unit: "m"
    },
    {
      key: "topLength",
      label: "Top Length",
      kind: "range",
      default: 2,
      min: 0,
      max: 50,
      step: 0.05,
      unit: "m"
    },
    {
      key: "topBreadth",
      label: "Top Breadth",
      kind: "range",
      default: 1.5,
      min: 0,
      max: 50,
      step: 0.05,
      unit: "m"
    },
    {
      key: "height",
      label: "Height",
      kind: "range",
      default: 3,
      min: 0.1,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posX",
      label: "Position X",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posY",
      label: "Position Y (up)",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posZ",
      label: "Position Z",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "rotX",
      label: "Rotate X",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotY",
      label: "Rotate Y",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotZ",
      label: "Rotate Z",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "scale",
      label: "Scale",
      kind: "range",
      default: 1,
      min: 0.1,
      max: 5,
      step: 0.05
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ]
};

// src/floorplan/flow/declarations/torus.node.json
var torus_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "torus",
  meta: {
    label: "Torus",
    category: "3d primitives",
    color: "#0e7490"
  },
  description: "3D primitive \u2014 a ring (donut): Ring Radius to the tube centre, Tube Radius thickness, optional partial Arc sweep. Lies FLAT on the floor; rotate X 90\xB0 to stand it up. Display 3D for colour.",
  instructions: "A TORUS (ring) \u2014 the tube's centreline circle has `ringRadius` metres, the tube itself `tubeRadius`; `arcDeg` < 360 sweeps a PARTIAL ring (a curved rail / arch segment \u2014 180 + Rotate X 90 = an arch). It lies FLAT in plan (a ring you look down on), resting on the floor; use Rotate X to stand it up. All params wireable; colour via Display 3D.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "ringRadius",
        label: "Ring Radius"
      },
      {
        key: "tubeRadius",
        label: "Tube Radius"
      },
      {
        key: "arcDeg",
        label: "Arc Sweep"
      },
      {
        key: "posX",
        label: "Position X"
      },
      {
        key: "posY",
        label: "Position Y (up)"
      },
      {
        key: "posZ",
        label: "Position Z"
      },
      {
        key: "rotX",
        label: "Rotate X"
      },
      {
        key: "rotY",
        label: "Rotate Y"
      },
      {
        key: "rotZ",
        label: "Rotate Z"
      },
      {
        key: "scale",
        label: "Scale"
      },
      {
        key: "show",
        label: "Show"
      }
    ]
  },
  parameters: [
    {
      key: "ringRadius",
      label: "Ring Radius",
      kind: "range",
      default: 1.5,
      min: 0.1,
      max: 25,
      step: 0.05,
      unit: "m"
    },
    {
      key: "tubeRadius",
      label: "Tube Radius",
      kind: "range",
      default: 0.3,
      min: 0.02,
      max: 5,
      step: 0.02,
      unit: "m"
    },
    {
      key: "arcDeg",
      label: "Arc Sweep",
      kind: "range",
      default: 360,
      min: 5,
      max: 360,
      step: 5,
      unit: "\xB0"
    },
    {
      key: "posX",
      label: "Position X",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posY",
      label: "Position Y (up)",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posZ",
      label: "Position Z",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "rotX",
      label: "Rotate X",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotY",
      label: "Rotate Y",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotZ",
      label: "Rotate Z",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "scale",
      label: "Scale",
      kind: "range",
      default: 1,
      min: 0.1,
      max: 5,
      step: 0.05
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ]
};

// src/floorplan/flow/declarations/capsule.node.json
var capsule_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "capsule",
  meta: {
    label: "Capsule",
    category: "3d primitives",
    color: "#0e7490"
  },
  description: "3D primitive \u2014 a pill: a cylinder of Mid Length capped by hemispheres of Radius, standing upright with its base on the floor at Y=0. Display 3D for colour; Transform 3D to lay it down.",
  instructions: "A CAPSULE (pill) \u2014 an upright cylinder of `length` metres capped top and bottom by hemispheres of `radius` (total height = length + 2\xB7radius), base resting on the floor (Y=0, Y up). Bollards, rounded columns, furniture legs. Rotate X/Z 90\xB0 to lay it down. All params wireable; colour via Display 3D.",
  handles: {
    input: false,
    output: true,
    valueInputs: [
      {
        key: "radius",
        label: "Radius"
      },
      {
        key: "length",
        label: "Mid Length"
      },
      {
        key: "posX",
        label: "Position X"
      },
      {
        key: "posY",
        label: "Position Y (up)"
      },
      {
        key: "posZ",
        label: "Position Z"
      },
      {
        key: "rotX",
        label: "Rotate X"
      },
      {
        key: "rotY",
        label: "Rotate Y"
      },
      {
        key: "rotZ",
        label: "Rotate Z"
      },
      {
        key: "scale",
        label: "Scale"
      },
      {
        key: "show",
        label: "Show"
      }
    ]
  },
  parameters: [
    {
      key: "radius",
      label: "Radius",
      kind: "range",
      default: 0.4,
      min: 0.05,
      max: 10,
      step: 0.05,
      unit: "m"
    },
    {
      key: "length",
      label: "Mid Length",
      kind: "range",
      default: 1.2,
      min: 0,
      max: 50,
      step: 0.05,
      unit: "m"
    },
    {
      key: "posX",
      label: "Position X",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posY",
      label: "Position Y (up)",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "posZ",
      label: "Position Z",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "rotX",
      label: "Rotate X",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotY",
      label: "Rotate Y",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "rotZ",
      label: "Rotate Z",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "scale",
      label: "Scale",
      kind: "range",
      default: 1,
      min: 0.1,
      max: 5,
      step: 0.05
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ]
};

// src/floorplan/flow/declarations/transform-3d.node.json
var transform_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "transform-3d",
  meta: { label: "Transform 3D", category: "3d primitives", color: "#7e22ce" },
  description: "Transform a 3D primitive \u2014 Translate (X/Y/Z) \xB7 Rotate (X/Y/Z) \xB7 uniform Scale \xB7 Mirror across a plane. Wire a Cuboid / Cylinder / Sphere / Cone in; chain several to stack. Y is up.",
  instructions: "Affine-transforms an upstream 3D primitive (Cuboid / Cylinder / Sphere / Cone / Mass): Translate (X/Y/Z, m) \xB7 Rotate about X/Y/Z (\xB0) \xB7 uniform Scale \xB7 Mirror across a plane. Y is up, Z is depth. Chain several to stack transforms. Wire a primitive into the input; wire the output into Display 3D or Boolean.\n\nTIP: use it to position primitive B relative to A before a Boolean, or to mirror a form across a plane.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "translateX", label: "Move X" },
      { key: "translateY", label: "Move Y" },
      { key: "translateZ", label: "Move Z" },
      { key: "rotateX", label: "Rotate X" },
      { key: "rotateY", label: "Rotate Y" },
      { key: "rotateZ", label: "Rotate Z" },
      { key: "scale", label: "Scale" },
      { key: "show", label: "Show" }
    ]
  },
  parameters: [
    { key: "translateX", label: "Move X", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "translateY", label: "Move Y (up)", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "translateZ", label: "Move Z", kind: "range", default: 0, min: -50, max: 50, step: 0.1, unit: "m" },
    { key: "rotateX", label: "Rotate X", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotateY", label: "Rotate Y", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "rotateZ", label: "Rotate Z", kind: "range", default: 0, min: -180, max: 180, step: 1, unit: "\xB0" },
    { key: "scale", label: "Scale", kind: "range", default: 1, min: 0.1, max: 5, step: 0.05 },
    {
      key: "mirror",
      label: "Mirror",
      kind: "select",
      default: "none",
      options: [
        { value: "none", label: "None" },
        { value: "x", label: "Across YZ (flip X)" },
        { value: "y", label: "Across XZ (flip Y)" },
        { value: "z", label: "Across XY (flip Z)" }
      ]
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ]
};

// src/floorplan/flow/declarations/boolean-3d.node.json
var boolean_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "boolean-3d",
  meta: { label: "Boolean", category: "3d primitives", color: "#7e22ce" },
  description: "Boolean (CSG) of two 3D primitives \u2014 Union \xB7 Subtract \xB7 Difference \xB7 Intersection. Wire primitive A into the main input and primitive B into the B input; move B (via Transform 3D) so they overlap.",
  instructions: "3D CSG of two primitives: the main input is A, the `gin-b` input is the second primitive B. Union (A \u222A B) \xB7 Subtract / Difference (A \u2212 B) \xB7 Intersection (A \u2229 B). Wire primitive A into the main input and B into the B input; position B (via a Transform 3D) so the two overlap meaningfully, else the result is empty or unchanged.\n\nTIP: Subtract to carve openings/voids; Intersection to keep only the common volume. Wire the output into Display 3D to style it.",
  handles: {
    input: true,
    output: true,
    geomInputs: [
      { key: "b", label: "B" }
    ],
    valueInputs: [
      {
        key: "show",
        label: "Show"
      }
    ]
  },
  parameters: [
    {
      key: "op",
      label: "Operation",
      kind: "select",
      default: "union",
      options: [
        { value: "union", label: "Union (A \u222A B)" },
        { value: "subtract", label: "Subtract (A \u2212 B)" },
        { value: "difference", label: "Difference (A \u2212 B)" },
        { value: "intersect", label: "Intersection (A \u2229 B)" }
      ]
    },
    {
      key: "show",
      label: "Show",
      kind: "checkbox",
      default: true
    }
  ]
};

// src/floorplan/flow/declarations/display-3d.node.json
var display_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "display-3d",
  meta: { label: "Display 3D", category: "3d primitives", color: "#7e22ce" },
  description: "Style a 3D primitive / Boolean for the 3D view \u2014 Colour \xB7 Opacity \xB7 Solid or Wireframe \xB7 Show edges. Wire a Cuboid / Cylinder / Sphere / Cone / Boolean in.",
  instructions: "Styles an upstream 3D primitive / Transform 3D / Boolean for the 3D view \u2014 Colour \xB7 Opacity \xB7 draw Type (Solid / Wireframe) \xB7 optional edge lines. Colour lives HERE (the primitive nodes carry none), so every visible 3D form should end in a Display 3D. Wire a primitive / boolean into the input.\n\nTIP: drop Opacity below 1 for glazing/study massing; turn on Show edges for a crisp architectural read.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "color", label: "Color" },
      { key: "opacity", label: "Opacity" },
      { key: "displayType", label: "Type" },
      { key: "showEdges", label: "Show edges" },
      { key: "show", label: "Show" }
    ]
  },
  parameters: [
    { key: "color", label: "Color", kind: "color", default: "#94a3b8" },
    { key: "opacity", label: "Opacity", kind: "range", default: 1, min: 0, max: 1, step: 0.05 },
    {
      key: "displayType",
      label: "Type",
      kind: "select",
      default: "solid",
      options: [
        { value: "solid", label: "Solid" },
        { value: "wireframe", label: "Wireframe" }
      ]
    },
    { key: "showEdges", label: "Show edges", kind: "checkbox", default: false },
    { key: "show", label: "Show", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/material.node.json
var material_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "material",
  meta: {
    label: "Material",
    category: "3d primitives",
    color: "#7c3aed"
  },
  description: "A LINK to one material file in Library/Materials. Wire it into a 3D Render row's green endpoint to give that primitive a material.",
  instructions: "The material twin of the Parametric Object node: it holds no geometry and computes nothing \u2014 it names a FILE and publishes that name, so a material is edited in one place and referenced from many.\n\nWIRING. Every 3D Render row grows a second, GREEN target endpoint (`matin-<rowId>`) beside its amber geometry one. Amber carries the row's face list, green carries its material. They are separate planes on purpose: the same material feeds a dozen rows across a dozen objects, while a face list belongs to exactly one row.\n\nPATH is Library-relative and includes the folder \u2014 \"Materials/Masonry/brick.json\". The file is resolved by whoever renders: nothing is inlined into the object, so retuning brick.json restyles every row that points at it without touching a single .pobj.\n\nWHAT A MATERIAL FILE HOLDS (schema `material/1`) \u2014 one flat recipe per renderer, never a serialised shader graph:\n\u2022 `procedural` \u2014 Blender's own texture-node vocabulary (brick / checker / noise / voronoi / wave / gradient / magic / white-noise) plus that node's inputs, in metres. The Blender importer expands the recipe into whatever node tree it wants; the file never describes the tree.\n\u2022 `pbr` \u2014 base colour, roughness, metallic (plus transmission / IOR for glazing). The fallback for any viewer that cannot evaluate a procedural \u2014 the 3D viewport and glTF export.\n\u2022 `plan2d` \u2014 the canvas hatch the 2D Render row draws: none / diagonal / dots, with spacing, angle and weight.\n\u2022 `dxf` \u2014 the ACAD pattern name the DXF export writes (AR-B816, AR-CONC, GRASS \u2026), with scale and angle.\n\nSo one name resolves to a procedural shader in Blender, a PBR colour in the viewport, a poch\xE9 hatch in plan and a real hatch pattern in the drawing \u2014 the four places a material has to appear, kept in step because they are four fields of one file rather than four unrelated settings.\n\nWITH NOTHING WIRED a row keeps its own flat colour, exactly as before. A material is additive: it never removes the row's colour, it supersedes it where a renderer can do better.",
  handles: {
    input: false,
    output: false,
    valueOutputs: [{ key: "material", label: "Material" }]
  },
  defaults: {
    path: "Materials/Masonry/brick.json"
  },
  parameters: [
    {
      key: "path",
      label: "File",
      kind: "text",
      default: "Materials/Masonry/brick.json",
      hint: "Library-relative path, e.g. Materials/Finishes/wood.json"
    }
  ]
};

// src/floorplan/flow/declarations/segment-source.node.json
var segment_source_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "segment-source",
  meta: {
    label: "Segment",
    category: "Segment",
    color: "#0f766e"
  },
  description: "Pipeline input \u2014 selected segment(s) by id (Select \u2192 Segment scope, or grab from selection). Emits each as a polyline; feeds Mitered Join / Graph Smoothing / Graph Metrics.",
  instructions: "GEOMETRY NODE: this is the single \"Geometry\" node \u2014 there is no kind selector, because THE CANVAS SELECTION IS THE SELECTOR. With \"Grab ID from selection\" on, selecting a canvas node makes it a Point source, a segment makes it a Segment source, a graph a Graph source, a space a Space source and a picture an Image source; the node keeps its id, name, position and wires across the change. That is what lets one input carry a host whose TYPE changes \u2014 the anchor of a parametric object stays wired while you switch from a node to a wall to a room. Turn the toggle off and type an id to pin it to one element. (Freehand is not selection-driven \u2014 its strokes are matched by colour \u2014 so it stays its own node.)\n\nEvery kind publishes its geometry in the same anchor-relative metre frame: a point list on `val-points` (Point \u2192 one row, Segment \u2192 two, Space \u2192 its outline) or nodes+links on `val-graph` (Graph, Freehand).\n\nPipeline input \u2014 emits the selected segment(s) as polylines (each wall = a 2-point polyline), scoped to individually-selected segments (Select \u2192 Segment scope). References segments by display id (e.g. Segment001, comma-separated for several); with 'Grab ID from selection' on, the id stays synced to the current canvas selection. One output handle per segment, or a single bundle (outputMode).\n\nTIP: feeds Mitered Join / Graph Smoothing / Graph Metrics like a graph. Turn grab OFF and type an id to pin a specific segment.\n\nVALUE OUTPUT: `val-points` publishes the segment as a TWO-ROW point list, `[[x1,y1],[x2,y2]]` in anchor-relative metres \u2014 the same shape and frame every other source publishes, so a Math Engine reads any source through the identical `points` variable and the Geometry hop is optional. `shift(points,-1) - points` is then the segment vector, `len(...)` its length. The FIRST referenced segment is published, first and last vertex. Segment Geometry still gives you the midpoint, angle, length and the four endpoint scalars.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nID. `val-id` publishes the id of the element this node resolves \u2014 `space-\u2026`, `segment-\u2026`, `node-\u2026`, each naming its own kind, and the SAME string the canvas shows, an export writes and this node's own ID field holds. Wire it into a Prompt Builder slot, an Output slot or an Input Properties text parameter to say WHICH element a run was about, rather than describing it by its coordinates. With several elements grabbed it is the comma-separated list, in the order they were selected; with nothing resolved it is empty.",
  handles: {
    input: false,
    output: true,
    geomInputs: [
      {
        key: "stamp",
        label: "Stamp"
      }
    ],
    outputCount: "outputMode == 'single' ? 1 : max(1, min(60, round(handleCount)))",
    valueOutputs: [
      {
        key: "id",
        label: "ID"
      },
      {
        key: "points",
        label: "Endpoints (list)"
      },
      {
        key: "canvasJson",
        label: "Canvas JSON"
      }
    ]
  },
  parameters: [
    {
      key: "grabFromSelection",
      label: "Grab ID from selection",
      kind: "checkbox",
      default: true
    },
    {
      key: "id",
      label: "ID",
      kind: "text",
      default: "",
      placeholder: "segment id (e.g. Segment001)",
      showWhen: "!grabFromSelection"
    },
    {
      key: "outputMode",
      label: "Outputs",
      kind: "select",
      default: "single",
      options: [
        {
          value: "single",
          label: "Single (all)"
        },
        {
          value: "perCell",
          label: "Per segment (one each)"
        }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/segment-split.node.json
var segment_split_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "segment-split",
  meta: { label: "Split Segment", category: "Segment", color: "#0d9488" },
  description: "Split each incoming segment into pieces \u2014 Based on Length (equal pieces, remainder kept), Based on Ratio (proportional list), or Based on Strip Length (a centred strip + outer remainders). One handle per piece, or a single bundle.",
  instructions: "Cuts each incoming segment (open polyline) into pieces. MODES (`mode`)\n\u2022 length \u2014 equal pieces of `pieceLength` (m); the final shorter remainder is kept.\n\u2022 ratio \u2014 a comma list (`ratios`) \u2192 one piece per entry, sized proportionally.\n\u2022 strip \u2014 a centred strip of `stripLength` (m) at `stripPosition` (%) \u2192 up to 3 pieces (before / strip / after).\n\nOne output handle per piece, or a single bundle (`outputMode`). Piece length / strip length / position are wireable.\n\nNOTE: the live handle count is baked from the actual geometry after evaluation; before the first run a ratio-mode node shows a provisional handle count.",
  handles: {
    input: true,
    output: true,
    outputCount: "outputMode == 'single' ? 1 : (handleCount >= 1 ? min(60, round(handleCount)) : (mode == 'strip' ? 3 : 2))",
    valueInputs: [
      { key: "pieceLength", label: "Piece length" },
      { key: "ratios", label: "Ratios" },
      { key: "stripLength", label: "Strip length" },
      { key: "stripPosition", label: "Position" }
    ]
  },
  parameters: [
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "length",
      options: [
        { value: "length", label: "Based on Length" },
        { value: "ratio", label: "Based on Ratio" },
        { value: "strip", label: "Based on Strip Length" }
      ]
    },
    { key: "pieceLength", label: "Piece length", kind: "range", default: 1, min: 0.05, max: 50, step: 0.05, unit: "m", showWhen: "mode != 'ratio' && mode != 'strip'" },
    { key: "ratios", label: "Ratios", kind: "text", default: "1, 2, 1", placeholder: "1, 2, 1", showWhen: "mode == 'ratio'" },
    { key: "stripLength", label: "Strip length", kind: "range", default: 1, min: 0.05, max: 50, step: 0.05, unit: "m", showWhen: "mode == 'strip'" },
    { key: "stripPosition", label: "Position", kind: "range", default: 50, min: 0, max: 100, step: 1, unit: "%", showWhen: "mode == 'strip'" },
    {
      key: "outputMode",
      label: "Outputs",
      kind: "select",
      default: "perCell",
      options: [
        { value: "perCell", label: "Per piece (one each)" },
        { value: "single", label: "Single (all pieces)" }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/display-segment.node.json
var display_segment_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "display-segment",
  meta: { label: "Display Segment", category: "Segment", color: "#b45309" },
  description: "Display a segment \u2014 Line (restyle stroke + direction arrow) or Buffered (thicken to a Space by Thickness, with a buffer style + optional hatch fill). Buffered output feeds the Space pipeline.",
  instructions: "Restyles or thickens an incoming segment. MODES (`mode`)\n\u2022 line \u2014 restyle the centerline stroke (line style / colour) + optional direction arrow; the geometry threads through unchanged.\n\u2022 buffered \u2014 thicken the segment into a Space by `thickness` (m, full ribbon width) with a buffer Style (capsule / square / flat) and optional hatch fill; the output is a Space that feeds the Space pipeline.\n\nSCHEMA-DRIVEN: wire a Schema into the Schema input (or attach one) and each segment styles per its own schema values by role (wall-color / wall-linestyle / show-direction / buffer-thickness / wall-justification / hatch\u2026); node params are the fallback. `applyTo` restricts styling to walls / doors / windows so it can coexist with Segment \u2192 Door / Window in one flow.",
  handles: {
    input: true,
    output: true,
    geomInputs: [
      { key: "schema", label: "Schema" }
    ],
    valueInputs: [
      { key: "thickness", label: "Thickness" }
    ]
  },
  defaults: { weight: 2 },
  parameters: [
    {
      key: "applyTo",
      label: "Apply to",
      kind: "select",
      default: "any",
      options: [
        { value: "any", label: "Any segment" },
        { value: "wall", label: "Walls only" },
        { value: "door", label: "Doors only" },
        { value: "window", label: "Windows only" }
      ]
    },
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "line",
      options: [
        { value: "line", label: "Line" },
        { value: "buffered", label: "Buffered" }
      ]
    },
    {
      key: "lineStyle",
      label: "Line Style",
      kind: "select",
      default: "solid",
      role: "wall-linestyle",
      options: [
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" }
      ],
      showWhen: "mode != 'buffered'"
    },
    { key: "color", label: "Color", kind: "color", default: "#334155", role: "wall-color" },
    { key: "showDirection", label: "Show Direction", kind: "checkbox", default: false, role: "show-direction" },
    { key: "thickness", label: "Thickness", kind: "range", default: 0.2, min: 0.02, max: 10, step: 0.02, unit: "m", role: "buffer-thickness", showWhen: "mode == 'buffered'" },
    {
      key: "justification",
      label: "Justification",
      kind: "select",
      default: "center",
      role: "wall-justification",
      options: [
        { value: "left", label: "Left" },
        { value: "center", label: "Center" },
        { value: "right", label: "Right" }
      ],
      showWhen: "mode == 'buffered'"
    },
    {
      key: "bufferStyle",
      label: "Buffer Style",
      kind: "select",
      default: "capsule",
      options: [
        { value: "capsule", label: "Capsule (round)" },
        { value: "square", label: "Square (extended)" },
        { value: "flat", label: "Flat (butt)" }
      ],
      showWhen: "mode == 'buffered'"
    },
    { key: "hatch", label: "Hatch", kind: "checkbox", default: false, role: "hatch", showWhen: "mode == 'buffered'" },
    {
      key: "hatchStyle",
      label: "Hatch Style",
      kind: "select",
      default: "diagonal",
      role: "hatch-style",
      options: [
        { value: "diagonal", label: "Diagonal lines" },
        { value: "dots", label: "Random dots" }
      ],
      showWhen: "mode == 'buffered' && hatch"
    },
    { key: "hatchSpacing", label: "Spacing", kind: "range", default: 8, min: 3, max: 40, step: 1, unit: "px", role: "hatch-spacing", showWhen: "mode == 'buffered' && hatch" },
    { key: "hatchAngle", label: "Angle", kind: "range", default: 45, min: 0, max: 180, step: 1, unit: "\xB0", role: "hatch-angle", showWhen: "mode == 'buffered' && hatch && hatchStyle == 'diagonal'" },
    { key: "hatchWeight", label: "Weight", kind: "range", default: 1, min: 0.5, max: 5, step: 0.5, unit: "px", showWhen: "mode == 'buffered' && hatch" }
  ]
};

// src/floorplan/flow/declarations/bloom.node.json
var bloom_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "bloom",
  meta: { label: "Bloom", category: "Node", color: "#7c3aed" },
  description: "Grow each input node/point into a Space \u2014 Polygon (n-gon; 4 sides \u2192 width \xD7 height rectangle; regular or irregular), Circle (radius), or Ellipse (width \xD7 height). Feeds the Space pipeline.",
  instructions: "Grows each incoming node/point into a Space. FORM (`form`)\n\u2022 polygon \u2014 an n-gon of `sides` sides (regular, or irregular jittered by `jitter` / `seed`); when sides = 4 it's a rectangle sized by `width` \xD7 `height` (radius ignored).\n\u2022 circle \u2014 of `radius`.\n\u2022 ellipse \u2014 with `width` \xD7 `height` axes.\n\nWire nodes / points in (e.g. from a Node source); the output Space feeds the Space pipeline. `radius` and `sides` are wireable.\n\nTIP: use it to turn junction points into room seeds; Irregular polygons give organic footprints.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "radius", label: "Radius" },
      { key: "sides", label: "Sides" }
    ]
  },
  parameters: [
    {
      key: "form",
      label: "Form",
      kind: "select",
      default: "polygon",
      options: [
        { value: "polygon", label: "Polygon" },
        { value: "circle", label: "Circle" },
        { value: "ellipse", label: "Ellipse" }
      ]
    },
    { key: "sides", label: "Sides", kind: "range", default: 6, min: 3, max: 16, step: 1, showWhen: "form == 'polygon'" },
    { key: "radius", label: "Radius", kind: "range", default: 1, min: 0.05, max: 10, step: 0.05, unit: "m", showWhen: "form == 'circle' || (form == 'polygon' && sides != 4)" },
    { key: "width", label: "Width", kind: "range", default: 2, min: 0.05, max: 20, step: 0.05, unit: "m", showWhen: "form == 'ellipse' || (form == 'polygon' && sides == 4)" },
    { key: "height", label: "Height", kind: "range", default: 2, min: 0.05, max: 20, step: 0.05, unit: "m", showWhen: "form == 'ellipse' || (form == 'polygon' && sides == 4)" },
    { key: "rotation", label: "Rotation", kind: "range", default: 0, min: 0, max: 360, step: 1, unit: "\xB0" },
    {
      key: "regularity",
      label: "Shape",
      kind: "select",
      default: "regular",
      options: [
        { value: "regular", label: "Regular" },
        { value: "irregular", label: "Irregular" }
      ],
      showWhen: "form == 'polygon'"
    },
    { key: "jitter", label: "Jitter", kind: "range", default: 0.3, min: 0, max: 1, step: 0.05, showWhen: "form == 'polygon' && regularity == 'irregular'" },
    { key: "seed", label: "Seed", kind: "range", default: 1, min: 1, max: 999, step: 1, showWhen: "form == 'polygon' && regularity == 'irregular'" }
  ]
};

// src/floorplan/flow/declarations/node-source.node.json
var node_source_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "node-source",
  meta: {
    label: "Node",
    category: "Node",
    color: "#4f46e5"
  },
  description: "Pipeline input \u2014 selected node(s)/point(s) by id (Select \u2192 Node scope, or grab from selection). Emits each as a point; feed into Buffer to get a disk Space.",
  instructions: "GEOMETRY NODE: this is the single \"Geometry\" node \u2014 there is no kind selector, because THE CANVAS SELECTION IS THE SELECTOR. With \"Grab ID from selection\" on, selecting a canvas node makes it a Point source, a segment makes it a Segment source, a graph a Graph source, a space a Space source and a picture an Image source; the node keeps its id, name, position and wires across the change. That is what lets one input carry a host whose TYPE changes \u2014 the anchor of a parametric object stays wired while you switch from a node to a wall to a room. Turn the toggle off and type an id to pin it to one element. (Freehand is not selection-driven \u2014 its strokes are matched by colour \u2014 so it stays its own node.)\n\nEvery kind publishes its geometry in the same anchor-relative metre frame: a point list on `val-points` (Point \u2192 one row, Segment \u2192 two, Space \u2192 its outline) or nodes+links on `val-graph` (Graph, Freehand).\n\nPipeline input \u2014 emits the selected canvas node(s) (junction points) as single points, scoped by Select \u2192 Node. References nodes by display id (e.g. Node001, comma-separated); with 'Grab ID from selection' on, the id stays synced to the node selection. One output handle per node, or a single bundle (`outputMode`).\n\nSTAMP: wire a Footing \u2192 Footing-to-Plan / Elevation / 3D-Mesh (or any origin-relative drawing / mesh) into the Stamp input and the node stamps a copy at each of its point(s) \u2014 placement by location.\n\nTIP: wire the point output into Bloom / Buffer to grow each point into a Space.\n\nVALUE OUTPUT: `val-points` publishes this node's position as a ONE-ROW point list, `[[x,y]]` in anchor-relative metres \u2014 the same shape and frame every other source publishes (Space \u2192 its outline, Segment \u2192 its two endpoints), so a Math Engine or a Matrix node reads any source through the identical `points` variable and the Geometry hop is optional. The FIRST referenced node is published. Node Geometry still gives you `val-x` / `val-y` as separate scalars when a plain number is what you want.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nID. `val-id` publishes the id of the element this node resolves \u2014 `space-\u2026`, `segment-\u2026`, `node-\u2026`, each naming its own kind, and the SAME string the canvas shows, an export writes and this node's own ID field holds. Wire it into a Prompt Builder slot, an Output slot or an Input Properties text parameter to say WHICH element a run was about, rather than describing it by its coordinates. With several elements grabbed it is the comma-separated list, in the order they were selected; with nothing resolved it is empty.",
  handles: {
    input: false,
    output: true,
    geomInputs: [
      {
        key: "stamp",
        label: "Stamp"
      }
    ],
    outputCount: "outputMode == 'single' ? 1 : max(1, min(60, round(handleCount)))",
    valueOutputs: [
      {
        key: "id",
        label: "ID"
      },
      {
        key: "points",
        label: "Point (list)"
      },
      {
        key: "canvasJson",
        label: "Canvas JSON"
      }
    ]
  },
  parameters: [
    {
      key: "grabFromSelection",
      label: "Grab ID from selection",
      kind: "checkbox",
      default: true
    },
    {
      key: "id",
      label: "ID",
      kind: "text",
      default: "",
      placeholder: "node id (e.g. Node001)",
      showWhen: "!grabFromSelection"
    },
    {
      key: "outputMode",
      label: "Outputs",
      kind: "select",
      default: "single",
      options: [
        {
          value: "single",
          label: "Single (all)"
        },
        {
          value: "perCell",
          label: "Per node (one each)"
        }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/node-geometry.node.json
var node_geometry_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "node-geometry",
  meta: { label: "Node Geometry", category: "Node", color: "#4f46e5" },
  description: "Reads a Node and outputs its X / Y canvas position in metres (val-x / val-y).",
  instructions: "Wire a Node source into the input; this publishes that node's canvas position as `val-x` / `val-y` value outputs, in metres. Wire those into a Point's X / Y (or any value input) to place geometry at the node \u2014 the coordinate follows the node when it moves. It has no geometry of its own.",
  handles: {
    input: true,
    output: false,
    valueOutputs: [
      { key: "x", label: "X", unit: "m" },
      { key: "y", label: "Y", unit: "m" }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/segment-geometry.node.json
var segment_geometry_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "segment-geometry",
  meta: { label: "Segment Geometry", category: "Segment", color: "#0f766e" },
  description: "Reads a Segment and outputs its two endpoints (x1,y1 / x2,y2), midpoint (x,y), angle and length.",
  instructions: "Wire a Segment source into the input; this publishes the segment's two ENDPOINTS `val-x1`/`val-y1` and `val-x2`/`val-y2`, its MIDPOINT `val-x`/`val-y`, plus `val-angle` (degrees) and `val-length` (metres) \u2014 all in metres. Wire the midpoint into a Point to place an object on the segment, or the endpoints / angle to build and orient it along the wall (e.g. a door). It has no geometry of its own.",
  handles: {
    input: true,
    output: false,
    valueOutputs: [
      { key: "x", label: "X (mid)", unit: "m" },
      { key: "y", label: "Y (mid)", unit: "m" },
      { key: "x1", label: "X1 (start)", unit: "m" },
      { key: "y1", label: "Y1 (start)", unit: "m" },
      { key: "x2", label: "X2 (end)", unit: "m" },
      { key: "y2", label: "Y2 (end)", unit: "m" },
      { key: "angle", label: "Angle", unit: "\xB0" },
      { key: "length", label: "Length", unit: "m" }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/display-node.node.json
var display_node_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "display-node",
  meta: { label: "Display Node", category: "Node", color: "#475569" },
  description: "Draw the input node as a marker \u2014 shape / style / colour / size / hatch (passes the node through).",
  instructions: "Draws each incoming node (point) as a marker \u2014 Shape (dot / circle / square / triangle) \xB7 stroke Style \xB7 Colour \xB7 Size \xB7 optional diagonal / dots hatch fill \u2014 and threads it downstream unchanged.\n\nSCHEMA-DRIVEN: wire a Schema into the Schema input (or attach one) and each node styles per its own schema values by role (node-shape / node-style / node-color / node-size / node-hatch\u2026); node params are the fallback. `applyTo` restricts marking to plain nodes vs object nodes so it can coexist with Node \u2192 Object. Exposes its params on the `pout` endpoint so an Input Schema node can derive a Node schema from them.",
  handles: {
    input: true,
    output: true,
    exposesParams: true,
    geomInputs: [
      { key: "schema", label: "Schema" }
    ]
  },
  parameters: [
    {
      key: "applyTo",
      label: "Apply to",
      kind: "select",
      default: "any",
      options: [
        { value: "any", label: "Any node" },
        { value: "node", label: "Nodes only" },
        { value: "object", label: "Objects only" }
      ]
    },
    {
      key: "shape",
      label: "Shape",
      kind: "select",
      default: "dot",
      role: "node-shape",
      options: [
        { value: "dot", label: "Dot" },
        { value: "circle", label: "Circle" },
        { value: "square", label: "Square" },
        { value: "triangle", label: "Triangle" }
      ]
    },
    {
      key: "style",
      label: "Style",
      kind: "select",
      default: "solid",
      role: "node-style",
      options: [
        { value: "solid", label: "Solid" },
        { value: "dashed", label: "Dashed" },
        { value: "dotted", label: "Dotted" }
      ]
    },
    { key: "color", label: "Color", kind: "color", default: "#475569", role: "node-color" },
    { key: "size", label: "Size", kind: "range", default: 1, min: 0.5, max: 5, step: 0.5, unit: "\xD7", role: "node-size" },
    { key: "hatch", label: "Hatch", kind: "checkbox", default: false, role: "node-hatch" },
    {
      key: "hatchStyle",
      label: "Hatch Style",
      kind: "select",
      default: "diagonal",
      role: "node-hatch-style",
      options: [
        { value: "diagonal", label: "Diagonal lines" },
        { value: "dots", label: "Random dots" }
      ],
      showWhen: "hatch"
    },
    { key: "spacing", label: "Spacing", kind: "range", default: 8, min: 3, max: 40, step: 1, unit: "px", role: "node-hatch-spacing", showWhen: "hatch" },
    { key: "angle", label: "Angle", kind: "range", default: 45, min: 0, max: 180, step: 1, unit: "\xB0", role: "node-hatch-angle", showWhen: "hatch && hatchStyle == 'diagonal'" },
    { key: "weight", label: "Weight", kind: "range", default: 1, min: 0.5, max: 5, step: 0.5, unit: "px", showWhen: "hatch" }
  ]
};

// src/floorplan/flow/declarations/canvas-source.node.json
var canvas_source_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "canvas-source",
  meta: { label: "Canvas", category: "Canvas", color: "#0891b2" },
  description: "The whole canvas as five outputs \u2014 Spaces, Nodes, Segments, Graph, Images (footprints). Each carries every item of its kind. Independent of selection.",
  instructions: "Emits the WHOLE canvas as five typed outputs \u2014 Spaces, Nodes, Segments, Graph, Images (footprints) \u2014 each carrying EVERY item of its kind, independent of the current selection. Wire any output into the matching pipeline (e.g. Spaces \u2192 Inset, Segments \u2192 Mitered Join, Nodes \u2192 Bloom).\n\nThe input endpoint accepts a Schema node to attach Node / Segment / Graph schema properties to the canvas components; geometry still comes from the canvas (any incoming geometry is ignored).",
  handles: {
    input: true,
    output: true,
    outputCount: "5",
    outputLabels: ["Spaces", "Nodes", "Segments", "Graph", "Images"]
  },
  parameters: []
};

// src/floorplan/flow/declarations/freehand-source.node.json
var freehand_source_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "freehand-source",
  meta: {
    label: "Freehand",
    category: "Canvas",
    color: "#ea580c"
  },
  description: "Pipeline input \u2014 the freehand strokes drawn on the canvas, as a polyline network (a graph). Optionally filtered by stroke colour. Feeds the Graph nodes.",
  instructions: "GEOMETRY NODE: this is the single \"Geometry\" node \u2014 there is no kind selector, because THE CANVAS SELECTION IS THE SELECTOR. With \"Grab ID from selection\" on, selecting a canvas node makes it a Point source, a segment makes it a Segment source, a graph a Graph source, a space a Space source and a picture an Image source; the node keeps its id, name, position and wires across the change. That is what lets one input carry a host whose TYPE changes \u2014 the anchor of a parametric object stays wired while you switch from a node to a wall to a room. Turn the toggle off and type an id to pin it to one element. (Freehand is not selection-driven \u2014 its strokes are matched by colour \u2014 so it stays its own node.)\n\nEvery kind publishes its geometry in the same anchor-relative metre frame: a point list on `val-points` (Point \u2192 one row, Segment \u2192 two, Space \u2192 its outline) or nodes+links on `val-graph` (Graph, Freehand).\n\nPipeline input \u2014 emits the canvas's freehand drawing as connected polylines (a graph). Set `Colour` to grab only strokes of that hex colour (blank = every freehand stroke).\n\nFreehand is already VECTOR, so no raster Vectorise is needed \u2014 wire this straight into a Graph Reduce (Dissolve merges chains, Prune drops spurs) to tidy the wobble into a clean node/edge graph, then Mitered Join / Graph to Spaces as usual.\n\nVALUE OUTPUT: `val-graph` publishes the strokes as graph JSON (anchor-relative metres), the same serialisation Freehand Geometry emits \u2014 so the pure-value Graph nodes (Set Thickness, Merge Graph, Mitered Join, Graph to Points) can consume the drawing directly and the Geometry hop is optional.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.",
  handles: {
    input: false,
    output: true,
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "canvasJson",
        label: "Canvas JSON"
      }
    ]
  },
  parameters: [
    {
      key: "color",
      label: "Colour",
      kind: "text",
      default: "",
      placeholder: "#ea580c (blank = all)"
    }
  ]
};

// src/floorplan/flow/declarations/freehand-geometry.node.json
var freehand_geometry_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "freehand-geometry",
  meta: {
    label: "Freehand Geometry",
    category: "Freehand",
    color: "#ea580c"
  },
  description: "Read the wired Freehand source and publish its strokes as graph JSON \u2014 the node id list plus every edge (from_node_id, to_node_id). Forwards the graph on.",
  instructions: 'Wire a Freehand source into this node to publish the freehand drawing\'s STRUCTURE as JSON on `val-graph`:\n\n{ "nodes": [{ "id": "n1", "x": 0, "y": 0 }, \u2026],\n  "edges": [{ "from_node_id": "n1", "to_node_id": "n2" }, \u2026] }\n\nEach stroke becomes a chain of nodes/edges. Node positions are METRES relative to the drawing centroid, so the JSON can be fed straight into a Network node to redraw it, or into the pure-value Graph nodes (Set Thickness, Merge Graph, Mitered Join, Graph to Openings) \u2014 freehand is already vector, so no raster Vectorise is needed.\n\nThe strokes are forwarded unchanged on the main output too, so this node can sit inline in a pipeline (e.g. Freehand \u2192 Freehand Geometry \u2192 Graph Reduce). Also publishes `val-nodeCount` / `val-edgeCount` for wiring into Math / Output.',
  handles: {
    input: true,
    output: true,
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/separate.node.json
var separate_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "separate",
  meta: { label: "Separate", category: "Canvas", color: "#0e7490" },
  description: "Fan a multi-item input out to one output endpoint per item (e.g. Canvas \u2192 Spaces \u2192 one handle per space). Feeds each item downstream individually.",
  instructions: "Fan-out \u2014 takes ONE multi-item input bundle (spaces / segments / graphs / points) and exposes each item on its own output handle (out-0, out-1, \u2026). The handle count tracks the live input count.\n\nTIP: put it after a Canvas \u2192 Spaces output (or any 'single' bundle) to drive each item down its own branch.",
  handles: {
    input: true,
    output: true,
    outputCount: "max(1, min(80, round(handleCount)))"
  },
  parameters: []
};

// src/floorplan/flow/declarations/filter-by-type.node.json
var filter_by_type_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "filter-by-type",
  meta: { label: "Filter by Type", category: "Canvas", color: "#0e7490" },
  description: "Split a Canvas Spaces bundle by what each space IS \u2014 the value of a parameter on its attached object (default `identifyingType`). Matching spaces leave on the first output, the rest on the second.",
  instructions: 'Answers the question a flow could not previously ask: WHICH of these spaces is a road, and which is a plot.\n\nA Canvas bundle is geometry \u2014 polygons and nothing else \u2014 so until now every space in it looked alike. This node reads the parametric object ATTACHED to each space and keeps the ones whose named parameter equals Type.\n\nWIRING: Canvas \u2192 Spaces \u2192 Filter by Type. Two geometry outputs: out-0 MATCHING, out-1 REST. Wire the one you want onward; leaving the other unwired is normal (use it to draw the complement, or to check nothing was missed).\n\nPARAMETERS\n\u2022 TYPE \u2014 the value to match, compared case-insensitively after trimming ("Road" matches "road"). Blank matches nothing rather than everything: a half-typed filter should produce no plots, not all of them.\n\u2022 PARAMETER KEY \u2014 which parameter carries the classification. Defaults to `identifyingType`, the read-only tag plot.json and road.json declare. Point it at another key to slice by something else \u2014 the same Spaces bundle can be filtered by `color`, or by any select the attached object exposes.\n\nWHAT IT MATCHES AGAINST is the attached object\'s parameters with the instance\'s edits on top, so a space answers with its default classification even if that parameter was added to the object AFTER the object was placed. A space with NO attached object matches nothing and always lands in Rest.\n\nMATCHING BY TAG, NOT BY OBJECT ID, is deliberate. An id (`road-with-math`) breaks the moment the object is renamed and cannot express "these three different objects are all roads". A tag is stable and shared.\n\nBOTH HALVES ARE ALSO VALUES. `val-matching` / `val-rest` carry the same polygons as a GROUPED FLAT matrix \u2014 one row per vertex, `[x, y, groupIndex]`, anchor-relative metres \u2014 which is how geometry reaches a Math Engine, since only a value wire can. Feed either into an expression and `inpoly` reads the group column back as one ring per space. `val-matchCount` / `val-restCount` are the counts.\n\nIDENTITY IS RESOLVED BY POSITION IN THE CANVAS BUNDLE, so wire this DIRECTLY to a Canvas output. An op in between (Inset, Transform, Merge \u2026) rebuilds the polygons and their correspondence to the canvas is lost \u2014 filter FIRST, then operate on the half you kept.\n\nIt produces no geometry of its own and commits nothing: it is a selector, so it is preview / Flow-Live only and never appears as a recipe op.',
  handles: {
    input: true,
    output: true,
    outputCount: "2",
    outputLabels: ["Matching", "Rest"],
    valueOutputs: [
      { key: "matching", label: "Matching (grouped)" },
      { key: "rest", label: "Rest (grouped)" },
      { key: "matchCount", label: "Matched" },
      { key: "restCount", label: "Rest count" }
    ]
  },
  parameters: [
    {
      key: "type",
      label: "Type",
      kind: "text",
      default: "road",
      placeholder: "road"
    },
    {
      key: "paramKey",
      label: "Parameter key",
      kind: "text",
      default: "identifyingType",
      placeholder: "identifyingType"
    }
  ]
};

// src/floorplan/flow/declarations/set-object-param.node.json
var set_object_param_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "set-object-param",
  meta: {
    label: "Set Object Param",
    category: "Canvas",
    color: "#b45309"
  },
  description: "Write one parameter onto the parametric object attached to each incoming space, node or segment \u2014 the flow's only way to change something that already exists on the canvas. Computes the writes live; applies them only when you press Apply.",
  instructions: 'Every other node in the flow MAKES geometry. This one EDITS what is already on the plan, which is why it never fires on its own.\n\nWIRING: a Spaces bundle into the geometry input (Filter by Type\'s Matching output is the usual source), and an ASSIGNMENT matrix into `valin-values`.\n\nTHE ASSIGNMENT MATRIX is N x 2: each row is `[indexInTheIncomingBundle, value]`. The index is position in the bundle wired in, counting from 0 \u2014 so a Math Engine that looped over those spaces in order can emit `hcat(i, result)` and it lines up. Rows whose index is out of range are dropped rather than wrapped. A space the matrix says nothing about is left alone; this never clears a parameter it was not told about.\n\nPARAMETER KEY names the parameter to write \u2014 `direction`, `booked`, `number`. It must exist on the attached object, or that write is skipped and counted as unmatched (the readout tells you how many).\n\nVALUE MAP turns the numbers a Math Engine can produce into the strings a SELECT parameter needs, and takes two kinds of entry in one list. A BARE WORD is positional \u2014 its place in the list is the code it names, so `North,East,South,West` writes "North" for 0 and "East" for 1. An `n=Word` entry names one specific code, which is how a sentinel outside that range gets a word: `-1=Empty,-2=Road`. Mix them freely. Leave the whole thing BLANK for a numeric or checkbox parameter and the number is written as-is. A value with no entry in a non-empty map is skipped, so a -1 meaning "undecided" writes nothing rather than defaulting to the first option.\n\nTEMPLATE composes a STRING out of several columns, which is the only way a flow can write a formatted value \u2014 a Math Engine can put numbers on a wire and nothing else. Set it and the assignment matrix widens to `[i, v0, v1, \u2026]`, with each `{0}`, `{1}` \u2026 replaced by that column, each passed through the value map first. `East:{0}, West:{1}, North:{2}, South:{3}` over a row `[i, 20, 21, -2, -1]` with map `-1=Empty,-2=Road` writes "East:20, West:21, North:Road, South:Empty". Blank template = the single-value behaviour above.\n\nAPPLY IS A SEPARATE, DELIBERATE STEP. The node continuously shows what it WOULD write; pressing Apply performs it as one undoable edit (Ctrl+Z restores every previous value at once). It is not part of Run Flow: Run compiles a recipe of geometry operations, and rewriting the parameters of dozens of placed objects is not something that should ride along silently with a geometry run.\n\nIDENTITY IS RESOLVED BY POSITION IN THE CANVAS BUNDLE \u2014 the same rule Filter by Type follows \u2014 so keep this on a path that has not rebuilt the geometry. Filter, compute, write; do not Inset in between.\n\nA space with NO attached object is skipped and counted as unmatched. Writing the value a parameter already holds is not an error, just a no-op the count still reports.\n\nSPACES, NODES AND SEGMENTS. All three carry parametric objects, so all three can be addressed; `Host` picks which, and Auto is right whenever the bundle came straight off the Canvas node. Identity is resolved by POSITION IN THAT COLLECTION, so keep this on a path that has not rebuilt the geometry - and note that index 3 means a different element in each of the three, which is why the choice is explicit rather than inferred from the parameter name.',
  handles: {
    input: true,
    output: true,
    outputCount: "1",
    outputLabels: [
      "Spaces (pass-through)"
    ],
    valueInputs: [
      {
        key: "values",
        label: "Assignments [i, value]"
      }
    ],
    valueOutputs: [
      {
        key: "writeCount",
        label: "Will write"
      },
      {
        key: "unmatched",
        label: "Skipped"
      }
    ]
  },
  parameters: [
    {
      key: "host",
      label: "Host",
      kind: "select",
      default: "auto",
      options: [
        {
          value: "auto",
          label: "Auto"
        },
        {
          value: "space",
          label: "Space"
        },
        {
          value: "node",
          label: "Node"
        },
        {
          value: "segment",
          label: "Segment"
        }
      ],
      help: "Which canvas collection the incoming bundle addresses. Auto matches the bundle against the canvas's own arrays by reference and falls back to its shape (1 point = node, 2 = segment, 3+ = space)."
    },
    {
      key: "paramKey",
      label: "Parameter key",
      kind: "text",
      default: "direction",
      placeholder: "direction"
    },
    {
      key: "valueMap",
      label: "Value map (code order, or n=Word)",
      kind: "text",
      default: "North,East,South,West",
      placeholder: "North,East,South,West"
    },
    {
      key: "template",
      label: "Template (blank = write the value itself)",
      kind: "text",
      default: "",
      placeholder: "East:{0}, West:{1}, North:{2}, South:{3}"
    }
  ]
};

// src/floorplan/flow/declarations/get-object-param.node.json
var get_object_param_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "get-object-param",
  meta: {
    label: "Get Object Param",
    category: "Canvas",
    color: "#0e7490"
  },
  description: "Read one parameter off the parametric object attached to each incoming space, node or segment and publish it as a matrix a Math Engine can use. The counterpart of Set Object Param.",
  instructions: "Filter by Type answers WHICH spaces; this answers WHAT THEY SAY. Wire a Spaces bundle in and it reads the named parameter off each space's attached object.\n\n`val-values` is an N x 2 matrix of `[indexInTheIncomingBundle, value]`, and the index is what makes it usable: a Math Engine looping over the same bundle can look a space's value up by position, and a row is present only for spaces that actually carry the parameter. `val-count` is how many were found, `val-missing` how many were not \u2014 a missing count equal to the bundle size means the parameter name is wrong or nothing is attached.\n\nVALUES ARE NUMERIC. A matrix holds numbers, so a parameter that does not parse as one is reported in `missing` rather than silently written as 0 \u2014 a plot with no Number is genuinely unknown, not plot zero. Read a numeric parameter here (Number, Thickness, a checkbox as 1/0); a select or a free-text parameter is not something an expression can carry.\n\nThe geometry passes straight through, so this can sit mid-chain without disturbing the pipeline.\n\nIDENTITY IS RESOLVED BY POSITION IN THE CANVAS BUNDLE \u2014 the same rule Filter by Type and Set Object Param follow \u2014 so keep it on a path that has not rebuilt the geometry.\n\nSPACES, NODES AND SEGMENTS. All three carry parametric objects, so all three can be addressed; `Host` picks which, and Auto is right whenever the bundle came straight off the Canvas node. Identity is resolved by POSITION IN THAT COLLECTION, so keep this on a path that has not rebuilt the geometry - and note that index 3 means a different element in each of the three, which is why the choice is explicit rather than inferred from the parameter name.",
  handles: {
    input: true,
    output: true,
    outputCount: "1",
    outputLabels: [
      "Spaces (pass-through)"
    ],
    valueOutputs: [
      {
        key: "values",
        label: "Values [i, v]"
      },
      {
        key: "count",
        label: "Found"
      },
      {
        key: "missing",
        label: "Missing"
      }
    ]
  },
  parameters: [
    {
      key: "host",
      label: "Host",
      kind: "select",
      default: "auto",
      options: [
        {
          value: "auto",
          label: "Auto"
        },
        {
          value: "space",
          label: "Space"
        },
        {
          value: "node",
          label: "Node"
        },
        {
          value: "segment",
          label: "Segment"
        }
      ],
      help: "Which canvas collection the incoming bundle addresses. Auto matches the bundle against the canvas's own arrays by reference and falls back to its shape (1 point = node, 2 = segment, 3+ = space)."
    },
    {
      key: "paramKey",
      label: "Parameter key",
      kind: "text",
      default: "number",
      placeholder: "number"
    }
  ]
};

// src/floorplan/flow/declarations/mass.node.json
var mass_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "mass",
  meta: { label: "Mass", category: "Mass", color: "#0e7490" },
  description: "A primitive 3D Mass \u2014 Cube (Length) \xB7 Cuboid (Length \xD7 Breadth \xD7 Height) \xB7 Sphere (Radius) \xB7 Cone (Radius, Height) \xB7 Cylinder (Radius, Height). Rendered in the 3D view as a starting Mass.",
  instructions: "A primitive 3D Mass generator (no input) \u2014 a Cube / Cuboid / Sphere / Cone / Cylinder of the given dimensions, rendered in the 3D view. A starting Mass to feed downstream Mass ops (Inset 3D / Smoothing 3D).\n\nOnly the dimensions relevant to the chosen shape are shown (Cube \u2192 Length; Cuboid \u2192 L \xD7 B \xD7 H; Sphere \u2192 Radius; Cone / Cylinder \u2192 Radius + Height).\n\nNOTE: unlike the newer Cuboid / Cylinder primitives, Mass carries its own colour and feeds the Mass-op chain.",
  handles: { input: false, output: true },
  parameters: [
    {
      key: "shape",
      label: "Shape",
      kind: "select",
      default: "cube",
      options: [
        { value: "cube", label: "Cube" },
        { value: "cuboid", label: "Cuboid" },
        { value: "sphere", label: "Sphere" },
        { value: "cone", label: "Cone" },
        { value: "cylinder", label: "Cylinder" }
      ]
    },
    { key: "length", label: "Length", kind: "range", default: 3, min: 0.1, max: 50, step: 0.1, unit: "m", showWhen: "shape == 'cube' || shape == 'cuboid'" },
    { key: "breadth", label: "Breadth", kind: "range", default: 2, min: 0.1, max: 50, step: 0.1, unit: "m", showWhen: "shape == 'cuboid'" },
    { key: "radius", label: "Radius", kind: "range", default: 1.5, min: 0.1, max: 25, step: 0.1, unit: "m", showWhen: "shape == 'sphere' || shape == 'cone' || shape == 'cylinder'" },
    { key: "height", label: "Height", kind: "range", default: 3, min: 0.1, max: 50, step: 0.1, unit: "m", showWhen: "shape == 'cuboid' || shape == 'cone' || shape == 'cylinder'" },
    { key: "color", label: "Color", kind: "color", default: "#94a3b8" }
  ]
};

// src/floorplan/flow/declarations/inset-3d.node.json
var inset_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "inset-3d",
  meta: { label: "Inset 3D", category: "Mass", color: "#0e7490" },
  description: "Inset a 3D Mass \u2014 shrink (Inside) or grow (Outside) its footprint by Offset \u2192 a new Mass. Feed a Mass from Space to 3D.",
  instructions: "A Mass op \u2014 insets (or outsets) each incoming Mass's footprint by Offset (Inside shrinks, Outside grows), producing a new Mass. Feed a Mass (from a Mass node, or Space \u2192 3D); the host extrudes the inset footprint.\n\nTIP: chain Inset 3D \u2192 Smoothing 3D to taper and round a massing block; stack several Inset 3D for a stepped tower.",
  handles: { input: true, output: true },
  parameters: [
    {
      key: "direction",
      label: "Direction",
      kind: "select",
      default: "inside",
      options: [
        { value: "inside", label: "Inside (shrink)" },
        { value: "outside", label: "Outside (grow)" }
      ]
    },
    { key: "offset", label: "Offset", kind: "range", default: 0.2, min: 0, max: 5, step: 0.05, unit: "m" }
  ]
};

// src/floorplan/flow/declarations/smooth-3d.node.json
var smooth_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "smooth-3d",
  meta: { label: "Smoothing 3D", category: "Mass", color: "#0e7490" },
  description: "Smooth a 3D Mass \u2014 rounds its footprint corners (more Iterations = rounder) so the extruded mass has smooth faces \u2192 a new Mass. Feed a Mass from Space to 3D / Inset 3D.",
  instructions: "A Mass op \u2014 rounds each incoming Mass's footprint corners (Chaikin corner-cutting; more Iterations = rounder) so the extruded mass has smooth vertical faces, producing a new Mass. Feed a Mass (from a Mass node / Space \u2192 3D / Inset 3D).",
  handles: { input: true, output: true },
  parameters: [
    { key: "iterations", label: "Iterations", kind: "range", default: 2, min: 1, max: 5, step: 1 }
  ]
};

// src/floorplan/flow/declarations/mesh-to-3d.node.json
var mesh_to_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "mesh-to-3d",
  meta: { label: "Mesh to 3D", category: "Mass", color: "#0891b2" },
  description: "Render any incoming 3D Mesh in the 3D view. The single terminal for all \u2026 to 3D Mesh nodes.",
  instructions: "TERMINAL \u2014 renders any incoming 3D Mesh (from a '\u2026 to 3D Mesh' node, e.g. Footing / Staircase / Space to 3D Mesh) into the 3D view. Generic: every node that produces a Mesh feeds this single terminal. No parameters; wire a Mesh into the input.",
  handles: { input: true, output: false },
  parameters: []
};

// src/floorplan/flow/declarations/graph-source.node.json
var graph_source_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-source",
  meta: {
    label: "Graph",
    category: "Graph",
    color: "#1e3a8a"
  },
  description: "Pipeline input \u2014 selected graph(s) by id (Select \u2192 Graph scope, or grab from selection). Outputs one handle per graph. Feeds Mitered Join / Graph Smoothing / Graph Metrics.",
  instructions: "GEOMETRY NODE: this is the single \"Geometry\" node \u2014 there is no kind selector, because THE CANVAS SELECTION IS THE SELECTOR. With \"Grab ID from selection\" on, selecting a canvas node makes it a Point source, a segment makes it a Segment source, a graph a Graph source, a space a Space source and a picture an Image source; the node keeps its id, name, position and wires across the change. That is what lets one input carry a host whose TYPE changes \u2014 the anchor of a parametric object stays wired while you switch from a node to a wall to a room. Turn the toggle off and type an id to pin it to one element. (Freehand is not selection-driven \u2014 its strokes are matched by colour \u2014 so it stays its own node.)\n\nEvery kind publishes its geometry in the same anchor-relative metre frame: a point list on `val-points` (Point \u2192 one row, Segment \u2192 two, Space \u2192 its outline) or nodes+links on `val-graph` (Graph, Freehand).\n\nPipeline input \u2014 emits one or more graphs (connected segment networks) as polylines. References graphs by display id (e.g. Graph001, comma-separated for several); with 'Grab ID from selection' on, the id stays synced to the graph selected via the Select tool (Graph scope). One output handle per graph, or a single bundle (`outputMode`).\n\nThe input endpoint accepts a Schema node to attach Node/Segment/Graph schema properties (geometry still comes from the canvas). Feeds Mitered Join / Graph Smoothing / Graph Metrics / Graph to Spaces.\n\nVALUE OUTPUT: `val-graph` publishes the graph as JSON \u2014 { nodes: [{id,x,y}], edges: [{from_node_id,to_node_id,thickness}] }, anchor-relative metres, with the canvas graph's REAL node ids and per-edge schema `wall-thickness`. It runs the same code as Graph Geometry's `val-graph`, so the two are interchangeable and the Geometry hop is optional; add Graph Geometry when you also want the node / edge counts, or when you need to restrict the JSON to a sub-graph wired into its input.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nID. `val-id` publishes the id of the element this node resolves \u2014 `space-\u2026`, `segment-\u2026`, `node-\u2026`, each naming its own kind, and the SAME string the canvas shows, an export writes and this node's own ID field holds. Wire it into a Prompt Builder slot, an Output slot or an Input Properties text parameter to say WHICH element a run was about, rather than describing it by its coordinates. With several elements grabbed it is the comma-separated list, in the order they were selected; with nothing resolved it is empty.",
  handles: {
    input: true,
    output: true,
    outputCount: "outputMode == 'single' ? 1 : max(1, min(40, round(handleCount)))",
    valueOutputs: [
      {
        key: "id",
        label: "ID"
      },
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "canvasJson",
        label: "Canvas JSON"
      }
    ]
  },
  parameters: [
    {
      key: "grabFromSelection",
      label: "Grab ID from selection",
      kind: "checkbox",
      default: true
    },
    {
      key: "id",
      label: "ID",
      kind: "text",
      default: "",
      placeholder: "graph id (e.g. Graph001)",
      showWhen: "!grabFromSelection"
    },
    {
      key: "outputMode",
      label: "Outputs",
      kind: "select",
      default: "perCell",
      options: [
        {
          value: "perCell",
          label: "Per graph (one each)"
        },
        {
          value: "single",
          label: "Single (all)"
        }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/mitered-join.node.json
var mitered_join_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "mitered-join",
  meta: {
    label: "Mitered Join",
    category: "Graph",
    color: "#b45309"
  },
  description: "A pure CALCULATION node \u2014 stroke a graph into mitred wall polygons: graph in, coordinates out. Draws nothing on canvas.",
  instructions: 'A value-only node: it strokes a GRAPH into one mitred wall polygon PER edge and returns them as a coordinate list. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Graph Geometry val-graph, or Skeleton val-branches, into valin-graph. With "Use same width for all" OFF, each edge is stroked at its own `thickness` (from Set Thickness / BSP); edges tagged type "opening" are skipped, leaving gaps.\n\nCOMBINING is delegated to other nodes: to dissolve the per-segment bands into one seamless poch\xE9 use Boolean 2D (Union) or Merge; to clip the walls to a footprint use Boolean 2D (Intersect); to keep only the outer boundary use Graph Reduce "Keep Outer Boundary" upstream.\n\nOUTPUT: val-polygons publishes the per-segment bands as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "width",
        label: "Width"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "useSameWidth",
      label: "Use same width for all",
      kind: "checkbox",
      default: true
    },
    {
      key: "width",
      label: "Width",
      kind: "range",
      default: 2,
      min: 0.1,
      max: 20,
      step: 0.1,
      unit: "m",
      showWhen: "useSameWidth"
    },
    {
      key: "join",
      label: "Joint type",
      kind: "select",
      default: "sharp",
      options: [
        {
          value: "sharp",
          label: "Sharp (mitred)"
        },
        {
          value: "curved",
          label: "Curved (rounded)"
        },
        {
          value: "rectangular",
          label: "Rectangular (boxed joints)"
        },
        {
          value: "square",
          label: "Square (projecting ends)"
        }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/graph-to-path.node.json
var graph_to_path_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-to-path",
  materialisesSpace: true,
  meta: { label: "Graph to Path", category: "Graph", color: "#0d9488" },
  description: "Thicken a graph (polylines \u2014 Skeleton branches, smoothed graphs, canvas Graphs) into ONE seamless constant-width PATH band (closed Space polygons) of Width metres \u2014 the Skeleton node's Make-path as its own reusable node. Clip to boundary trims the band to the source space. With the Flow Live toggle ON the band materialises as a real editable Space; Run Flow commits it as a Corridor Space.",
  instructions: "Takes a GRAPH input (polylines \u2014 e.g. Skeleton in Branches mode, Graph Smoothing, a canvas Graph source) and thickens every edge to a `width`-metre band, mitred flush at shared junctions and unioned into ONE seamless closed path polygon \u2014 the exact corridor machinery the Skeleton node's Make-path uses. `clipToBoundary` trims the band to the upstream Skeleton's source Space (or the `gin-boundary` clip Space when wired). One output handle per band, or a single bundle (`outputMode`). Every parameter is wireable (valin-*).\n\nWith the Flow Live toggle ON the band materialises as a REAL editable Space that tracks the params; Run Flow commits it as a Corridor-region Space. Idiom: Space \u2192 Skeleton (Branches, prune / longest branch as needed) \u2192 Graph to Path (width) \u2014 the decoupled Make-path.",
  handles: {
    input: true,
    output: true,
    outputCount: "outputMode == 'single' ? 1 : max(1, min(40, round(handleCount)))",
    geomInputs: [
      { key: "boundary", label: "Clip space" }
    ],
    valueInputs: [
      { key: "width", label: "Width" },
      { key: "clipToBoundary", label: "Clip to boundary" },
      { key: "outputMode", label: "Outputs" }
    ]
  },
  parameters: [
    { key: "width", label: "Width", kind: "range", default: 1, min: 0.1, max: 50, step: 0.1, unit: "m" },
    { key: "clipToBoundary", label: "Clip to boundary", kind: "checkbox", default: true },
    {
      key: "outputMode",
      label: "Outputs",
      kind: "select",
      default: "perCell",
      options: [
        { value: "perCell", label: "Per band (one each)" },
        { value: "single", label: "Single (all)" }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/graph-smooth.node.json
var graph_smooth_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-smooth",
  meta: {
    label: "Graph Smoothing",
    category: "Graph",
    color: "#9d174d"
  },
  description: "A pure CALCULATION node \u2014 smooth a graph: graph in, graph out. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a GRAPH as JSON and returns a graph as JSON. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Graph Geometry val-graph, or Skeleton val-branches, into valin-graph.\n\nOUTPUT: val-graph publishes the result in the same shape \u2014 wire it into a Network node to draw it, or into another graph value node to chain.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "level",
        label: "Smoothness"
      }
    ],
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "interpolate",
      label: "Through vertices",
      kind: "checkbox",
      default: true
    },
    {
      key: "level",
      label: "Smoothness",
      kind: "range",
      default: 2,
      min: 1,
      max: 8,
      step: 1
    }
  ]
};

// src/floorplan/flow/declarations/graph-metrics.node.json
var graph_metrics_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-metrics",
  meta: { label: "Graph Metrics", category: "Graph", color: "#0e7490" },
  description: "Measure an incoming graph: nodes, edges, faces, components, leaves, junctions, total length. Forwards the graph on.",
  instructions: "Reads an incoming GRAPH (polylines \u2014 e.g. Skeleton branches / selected Graph) and measures its topology. Forwards the graph unchanged on the main output so it can continue downstream; every metric is also published as a value-OUT for wiring into Math / Output:\n\u2022 nodes (unique vertices) \xB7 edges \xB7 faces (bounded regions, E\u2212V+C) \xB7 components (disconnected sub-graphs) \xB7 leaves (degree-1 tips) \xB7 junctions (degree \u22653) \xB7 total length (m).\n\nTIP: wire val-length or val-faces into an Output node's Metrics, or a Math node.",
  handles: {
    input: true,
    output: true,
    valueOutputs: [
      { key: "nodes", label: "Nodes" },
      { key: "edges", label: "Edges" },
      { key: "faces", label: "Faces" },
      { key: "components", label: "Components" },
      { key: "leaves", label: "Leaves" },
      { key: "junctions", label: "Junctions" },
      { key: "length", label: "Total length", unit: "m" }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/graph-geometry.node.json
var graph_geometry_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-geometry",
  meta: {
    label: "Graph Geometry",
    category: "Graph",
    color: "#0e7490"
  },
  description: "Read an incoming graph and publish it as JSON \u2014 the node id list plus every edge (from_node_id, to_node_id, thickness). Forwards the graph on.",
  instructions: 'Reads an incoming GRAPH (canvas segments / Skeleton branches) and publishes its STRUCTURE as JSON on `val-graph`:\n\n{ "nodes": [{ "id": "n1", "x": 0, "y": 0 }, \u2026],\n  "edges": [{ "from_node_id": "n1", "to_node_id": "n2", "thickness": 0.2 }, \u2026] }\n\nNode ids are the canvas graph\'s real ids, so they line up with the Schema / Properties tab. Thickness is in METRES \u2014 taken from the segment\'s schema `wall-thickness` attribute when one is set, otherwise from the drawn segment width.\n\nOnly the edges actually wired in are included: with a sub-graph on the input (e.g. one Skeleton branch) the JSON is restricted to it; with nothing matched, the whole canvas graph is published.\n\nThe graph itself is forwarded unchanged on the main output, so this node can sit inline in a pipeline. Also publishes `val-nodeCount` / `val-edgeCount` for wiring into Math / Output.\n\nNode positions are metres relative to the graph centroid, so the JSON can be fed straight into a Network node to redraw the graph.',
  handles: {
    input: true,
    output: true,
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/show-direction.node.json
var show_direction_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "show-direction",
  meta: { label: "Show Direction", category: "Graph", color: "#0369a1" },
  description: "Show flow direction on a graph \u2014 Diverging out of / Converging into a root, with arrows whose size tracks the flow level (downstream accumulation or depth). Forwards the graph on.",
  instructions: "Orients the incoming graph as a flow and draws arrowheads along each edge. `mode` = Diverging (out of a root source) or Converging (into a root sink). `root` picks that source/sink node (auto = a leaf, or topmost / bottommost / leftmost / rightmost / centremost). `levelMetric` = Accumulation (downstream) or Depth (from root); `scaleByLevel` sizes each arrow by its flow level (`arrowSize` is the base). The graph is forwarded unchanged. Arrow size is wireable.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "arrowSize", label: "Arrow size" }
    ]
  },
  parameters: [
    {
      key: "mode",
      label: "Flow",
      kind: "select",
      default: "diverging",
      options: [
        { value: "diverging", label: "Diverging (out)" },
        { value: "converging", label: "Converging (in)" }
      ]
    },
    {
      key: "root",
      label: "Source / Sink",
      kind: "select",
      default: "auto",
      options: [
        { value: "auto", label: "Auto (a leaf)" },
        { value: "top", label: "Topmost" },
        { value: "bottom", label: "Bottommost" },
        { value: "left", label: "Leftmost" },
        { value: "right", label: "Rightmost" },
        { value: "center", label: "Centremost" }
      ]
    },
    {
      key: "levelMetric",
      label: "Level",
      kind: "select",
      default: "accumulation",
      options: [
        { value: "accumulation", label: "Accumulation (downstream)" },
        { value: "depth", label: "Depth (from root)" }
      ]
    },
    { key: "arrowSize", label: "Arrow size", kind: "range", default: 0.6, min: 0.1, max: 3, step: 0.05, unit: "m" },
    { key: "scaleByLevel", label: "Scale by level", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/graph-to-spaces.node.json
var graph_to_spaces_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-to-spaces",
  materialisesSpace: true,
  materialisesSpaceEdges: false,
  meta: {
    label: "Graph to Spaces",
    category: "Graph",
    color: "#047857"
  },
  description: "Find the closed faces of a graph and turn them into Spaces. With Flow Live on, each face becomes a REAL Space on canvas \u2014 this is how a traced graph becomes rooms, since Live segments alone are ignored by auto room detection.",
  instructions: 'Takes a GRAPH as JSON and returns its closed faces as polygons.\n\nWITH FLOW LIVE ON each face is materialised as a REAL Space on canvas. This is the node that turns a traced floor plan into rooms: a Network node materialises the graph as canvas nodes and segments, but those segments are tagged flow-owned and auto room detection deliberately SKIPS them (otherwise the flow would read back its own output and oscillate), so walls alone never produce Spaces. Wire the same graph into this node as well and the rooms appear. Feed it a clean planar graph \u2014 run Fit Lines first so the sides are straight, junctions are shared and stray tails are trimmed, or faces will leak into one another.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Graph Geometry val-graph, or Skeleton val-branches, into valin-graph.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueOutputs: [
      {
        key: "spaces",
        label: "Spaces"
      },
      {
        key: "totalArea",
        label: "Total area",
        unit: "m\xB2"
      },
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ],
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "objectId",
        label: "Attach object (id)"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "objectId",
      label: "Attach object (id)",
      kind: "text",
      default: "",
      placeholder: "room-with-math"
    },
    {
      key: "objectParams",
      label: "Object params (JSON)",
      kind: "text",
      default: "",
      placeholder: '{"roomType": "Bedroom"}'
    },
    {
      key: "minArea",
      label: "Min area",
      kind: "range",
      default: 0,
      min: 0,
      max: 50,
      step: 0.5,
      unit: "m\xB2"
    }
  ]
};

// src/floorplan/flow/declarations/graph-reduce.node.json
var graph_reduce_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-reduce",
  meta: {
    label: "Graph Reduce",
    category: "Graph",
    color: "#0e7490"
  },
  description: "A pure CALCULATION node \u2014 clean / reduce a graph: graph in, graph out. Draws nothing on canvas.",
  instructions: `A value-only node: it takes a GRAPH as JSON and returns a graph as JSON. It has no geometry input or output and draws nothing on the canvas.

INPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Graph Geometry val-graph, or Skeleton val-branches, into valin-graph.

MODES include the Skeleton post-processing that used to live on the Skeleton node: Prune Spurs (drop leaf branches shorter than Min length), Longest Branch (keep only the weighted-diameter path), and Join to Boundary (extend each open leaf tip along its direction out to a boundary polygon \u2014 wire Space Geometry's val-points into valin-boundary).

OUTPUT: val-graph publishes the result in the same shape \u2014 wire it into a Network node to draw it, or into another graph value node to chain.

Every parameter is wireable (valin-*).`,
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "boundary",
        label: "Boundary"
      },
      {
        key: "minLength",
        label: "Min length"
      }
    ],
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "longest-branch",
      options: [
        {
          value: "longest-branch",
          label: "Longest Branch"
        },
        {
          value: "prune",
          label: "Prune Spurs"
        },
        {
          value: "dissolve",
          label: "Dissolve (merge chains)"
        },
        {
          value: "mst",
          label: "Min Spanning Tree"
        },
        {
          value: "largest",
          label: "Largest Component"
        },
        {
          value: "loops",
          label: "Keep Loops"
        },
        {
          value: "bridges",
          label: "Keep Bridges"
        },
        {
          value: "outer",
          label: "Keep Outer Boundary"
        },
        {
          value: "inner",
          label: "Keep Inner Segments"
        },
        {
          value: "join-boundary",
          label: "Join to Boundary"
        }
      ]
    },
    {
      key: "boundary",
      label: "Boundary (JSON)",
      kind: "text",
      default: "",
      showWhen: "mode == 'join-boundary'"
    },
    {
      key: "minLength",
      label: "Min branch length",
      kind: "range",
      default: 1,
      min: 0,
      max: 50,
      step: 0.1,
      unit: "m",
      showWhen: "mode == 'prune'"
    },
    {
      key: "iterate",
      label: "Prune to stable",
      kind: "checkbox",
      default: true,
      showWhen: "mode == 'prune'"
    },
    {
      key: "mergeTol",
      label: "Junction merge",
      kind: "range",
      default: 0.5,
      min: 0,
      max: 5,
      step: 0.05,
      unit: "m",
      showWhen: "mode == 'dissolve'"
    }
  ]
};

// src/floorplan/flow/declarations/graph-simplify.node.json
var graph_simplify_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-simplify",
  meta: {
    label: "Simplify",
    category: "Graph",
    color: "#0e7490"
  },
  description: "A pure CALCULATION node \u2014 Douglas\u2013Peucker simplify a graph: collapse dense / wobbly polylines into a few straight segments. Graph in, graph out; draws nothing.",
  instructions: "A value-only node: graph as JSON in, simplified graph as JSON out. It has no geometry input or output and draws nothing on the canvas.\n\nUse it to turn a hand-drawn or vectorised stroke (one vertex per pointer sample \u2014 hundreds of tiny edges) into a road-like network of a few straight runs. Runs Ramer\u2013Douglas\u2013Peucker on every polyline: interior vertices within Tolerance of the straightened line are dropped, endpoints and real corners are kept.\n\nTolerance is in METRES \u2014 bigger = fewer, straighter segments. A good starting point for freehand roads is ~0.3 m.\n\nINPUT: wire Freehand Geometry / Graph Geometry val-graph into valin-graph. OUTPUT: val-graph \u2014 chain into Graph Reduce (Dissolve) to fuse junctions, or into a Network node to draw. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "graph", label: "Graph" },
      { key: "tolerance", label: "Tolerance" }
    ],
    valueOutputs: [
      { key: "graph", label: "Graph (JSON)" }
    ]
  },
  parameters: [
    { key: "graph", label: "Graph (JSON)", kind: "text", default: "" },
    { key: "tolerance", label: "Tolerance", kind: "range", default: 0.3, min: 0, max: 5, step: 0.05, unit: "m" }
  ]
};

// src/floorplan/flow/declarations/graph-clip.node.json
var graph_clip_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-clip",
  meta: {
    label: "Clip inside Space",
    category: "Graph",
    color: "#0e7490"
  },
  description: "A pure CALCULATION node \u2014 clip a graph to a Space boundary: keep only the parts inside (or outside) the polygon. Graph in, graph out; draws nothing.",
  instructions: `A value-only node: graph as JSON in, clipped graph as JSON out. It has no geometry input or output and draws nothing on the canvas.

Each polyline is split at every crossing with the boundary polygon; the parts that fall INSIDE the Space are kept (switch Keep to "Outside Space" to keep the parts outside instead). Roads that run past the plot edge are trimmed to the plot.

INPUT: wire the graph (Freehand Geometry / Simplify / Graph Reduce val-graph) into valin-graph, and wire Space Geometry's val-points into valin-boundary to supply the plot outline. OUTPUT: val-graph \u2014 chain into a Network node to draw, or into another graph value node. Every parameter is wireable (valin-*).`,
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "graph", label: "Graph" },
      { key: "boundary", label: "Boundary" }
    ],
    valueOutputs: [
      { key: "graph", label: "Graph (JSON)" }
    ]
  },
  parameters: [
    { key: "graph", label: "Graph (JSON)", kind: "text", default: "" },
    { key: "boundary", label: "Boundary (JSON)", kind: "text", default: "" },
    {
      key: "mode",
      label: "Keep",
      kind: "select",
      default: "inside",
      options: [
        { value: "inside", label: "Inside Space" },
        { value: "outside", label: "Outside Space" }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/graph-fit-lines.node.json
var graph_fit_lines_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-fit-lines",
  meta: {
    label: "Fit Lines",
    category: "Graph",
    color: "#0e7490"
  },
  description: "A pure CALCULATION node \u2014 straighten a freehand scribble into clean straight sides: a scribbled triangle fits to 3 lines, a rectangle to 4, a stroke to 1. Graph in, graph out; draws nothing.",
  instructions: "A value-only node: graph as JSON in, straightened graph as JSON out. Draws nothing on the canvas.\n\nIt REBUILDS branches from the graph topology: endpoints within Junction merge are fused into shared nodes (each junction sits at the CENTROID of the merged points), then every chain of degree-2 nodes between two ANCHORS (a junction with 3+ edges, or a dead end) becomes one branch.\n\nEach branch is then fitted to a CHAIN OF STRAIGHT SEGMENTS: corners are detected (Douglas-Peucker at Fit tolerance), every run between two corners gets a total-least-squares best-fit line using all its samples, and the corners are re-derived as the INTERSECTIONS of those lines so they come out sharp. A branch that closes on itself (a scribbled loop, or ends meeting within tolerance) is fitted as a closed polygon, so a triangle gives 3 sides and a rectangle 4. A circle gives as many sides as Fit tolerance allows.\n\nPARAMS: Junction merge (m) \u2014 node-merge tolerance when rebuilding branches; raise it if a crossing splits into two junctions. Fit tolerance (m) \u2014 how far a fitted line may sit from the stroke; bigger means fewer, longer sides (raise it if a wobbly side breaks into several). Ortho (checkbox) \u2014 force every side exactly HORIZONTAL or VERTICAL (snapped to the world axes, each side going to whichever is nearer). This is the one for a floor-plan scribble drawn slightly skewed: it pulls the whole sketch straight. Sides that end up on the same axis are fused, so a shallow dog-leg becomes one clean run. Square up (deg) \u2014 the relative alternative: snap side directions to multiples of this angle, measured from the LONGEST side, so a rectangle drawn at an angle KEEPS its rotation but gets exact 90 deg corners; 0 = off, and leave it off for triangles or it will force them square. Ortho takes precedence over Square up (Square up is hidden while Ortho is on). Trim ends (m) \u2014 remove the OVERSHOOT stubs a scribble leaves poking past a crossing (the pen carrying on after the wall it was meeting), which is what leaves stray little tails sticking out of a traced floor plan. Only the part BEYOND the outermost crossing is cut, and only up to this length, so a wall that genuinely finishes in open space is never shortened; a tail longer than 40 percent of its own segment is also left alone, since that is a real limb rather than a slip. A segment that crosses nothing and is shorter than this is dropped as speckle. Raise it until the stray tails disappear; 0 = off. Degree (n) \u2014 the order of the polynomial fitted to each side: 1 (default) is a straight line, 2 a parabola, 3 a cubic, and so on up to 6. Corner detection still runs first at any degree, so a rectangle stays four separate sides rather than one curve smeared through its corners \u2014 each side is simply allowed to bow. Use 1 for architectural plans; raise it to follow a genuinely curved stroke with few pieces. Above 1 the output is sampled polylines rather than single segments, and Ortho / Square up / Trim ends' overshoot cutting do not apply (they are straight-line ideas); spur pruning still does.\n\nINPUT: wire a graph (Freehand Geometry / Graph Reduce / Simplify val-graph) into valin-graph. OUTPUT: val-graph \u2014 chain into Clip inside Space / Network / Set Thickness -> Mitered Join. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "graph", label: "Graph" },
      { key: "snapTol", label: "Junction merge" },
      { key: "tolerance", label: "Fit tolerance" },
      { key: "ortho", label: "Ortho" },
      { key: "angleSnap", label: "Square up" },
      { key: "trimEnds", label: "Trim ends" },
      { key: "degree", label: "Degree" }
    ],
    valueOutputs: [
      { key: "graph", label: "Graph (JSON)" }
    ]
  },
  parameters: [
    { key: "graph", label: "Graph (JSON)", kind: "text", default: "" },
    { key: "snapTol", label: "Junction merge", kind: "range", default: 0.3, min: 0, max: 5, step: 0.05, unit: "m" },
    { key: "tolerance", label: "Fit tolerance", kind: "range", default: 0.25, min: 0.01, max: 5, step: 0.01, unit: "m" },
    { key: "ortho", label: "Ortho", kind: "checkbox", default: false },
    { key: "angleSnap", label: "Square up", kind: "range", default: 0, min: 0, max: 90, step: 15, unit: "\xB0", showWhen: "!ortho" },
    { key: "trimEnds", label: "Trim ends", kind: "range", default: 0.5, min: 0, max: 5, step: 0.05, unit: "m" },
    { key: "degree", label: "Degree", kind: "range", default: 1, min: 1, max: 6, step: 1 }
  ]
};

// src/floorplan/flow/declarations/graph-classify.node.json
var graph_classify_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-classify",
  meta: {
    label: "Graph Classify",
    category: "Graph",
    color: "#0d9488"
  },
  description: "A pure CALCULATION node \u2014 classify a graph's branches into a road hierarchy and split them onto three outputs: Longest, Secondary, Tertiary. Draws nothing on canvas.",
  instructions: `A value-only node: one graph in as JSON, THREE graphs out as JSON (one per tier). No geometry input or output; draws nothing on the canvas.

WHAT IT DOES: hierarchical branch ordering of a tree-like graph (a skeleton / medial axis), like a Strahler / stream order for a road network. Working per connected component, it peels the single longest route through the component (its weighted diameter) \u2014 that trunk is the LONGEST tier. Removing it lets the branches that hung off the trunk fall out as their own pieces; the longest route of each is a SECONDARY branch. Everything left (branches off the secondaries, and deeper) is TERTIARY.

INPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Skeleton's val-branches (best after a Sampled Voronoi skeleton, which stays connected) or Graph Geometry's val-graph into valin-graph. For a single main spine rather than one-per-fragment, feed a CONNECTED graph (e.g. Graph Reduce -> Largest Component first).

OUTPUTS: val-longest, val-secondary and val-tertiary each publish that tier's edges as a graph in the same shape. Typical use \u2014 wire each output into its own Set Thickness (wide trunk, medium secondary, thin tertiary), then Merge Graph -> Mitered Join to stroke a hierarchical road network in one pass.`,
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      }
    ],
    valueOutputs: [
      {
        key: "longest",
        label: "Longest"
      },
      {
        key: "secondary",
        label: "Secondary"
      },
      {
        key: "tertiary",
        label: "Tertiary"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    }
  ]
};

// src/floorplan/flow/declarations/grid-geometry.node.json
var grid_geometry_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "grid-geometry",
  meta: { label: "Grid Geometry", category: "Grid", color: "#0e7490" },
  description: "Tap a grid-field and publish it as VALUE \u2014 a bare rows\xD7cols matrix (val-matrix), the full grid with its world frame (val-grid), plus val-rows / val-cols. The bridge from the grid / DEM pipeline into the Matrix nodes. Forwards the grid on.",
  instructions: "Wire any grid node (Grid, Fill Depressions, Flow Accumulation, Grid Distance, \u2026) into this node to expose its lattice as JSON \u2014 DECOUPLING the numbers from the on-canvas heatmap:\n\n \u2022 `val-matrix` \u2014 the cell values as a bare rows\xD7cols 2D array `[[\u2026],[\u2026],\u2026]` (row-major). Feed this into the Matrix nodes (Transpose / Multiply / Inverse / Least Squares).\n \u2022 `val-grid` \u2014 the same values plus the world frame `{ rows, cols, minX, minY, cellW, cellH }`, so the result can be georeferenced back onto the canvas.\n \u2022 `val-rows` / `val-cols` \u2014 the lattice dimensions, for Math / Output.\n\nThe grid is forwarded unchanged on the main output, so this can sit inline (e.g. Flow Accumulation \u2192 Grid Geometry \u2192 Render Grid). Draws nothing itself.",
  handles: {
    input: true,
    output: true,
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "grid", label: "Grid (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/render-grid.node.json
var render_grid_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "render-grid",
  meta: { label: "Render Grid 2D", category: "Grid", color: "#0e7490" },
  description: "The DECOUPLED display node \u2014 draw a grid-field OR a bare matrix on the canvas as a heatmap, categorical labels, or D8 flow arrows. Lets the compute grid nodes run value-only (their Preview off) while ONE render node shows the result. Forwards the grid on.",
  instructions: "Wire a grid into this node to DRAW it \u2014 display is separate from computation, so turn the compute nodes' Preview OFF and let this node visualise the result. Toggle this node's EYE to hide/show its render on the canvas.\n\nTWO INPUTS:\n \u2022 Geometry input \u2014 a grid-FIELD (Fill Depressions, Flow Accumulation, Watershed, Grid Threshold, \u2026). Keeps the field's own world frame.\n \u2022 valin-matrix \u2014 a bare MATRIX value (val-matrix from Grid Geometry / Transpose / Inverse). A matrix has no world frame, so it's placed with Cell size + Origin X/Y \u2014 OFFSET the origin to sit the result BESIDE the source grid (so you can compare, or hide one and show the other).\n\nMODE:\n \u2022 Heatmap \u2014 a Low\u2192High colour ramp over the cell values.\n \u2022 Categorical \u2014 a distinct hue per integer value (basins, masks, labels).\n \u2022 Arrows \u2014 heatmap cells + a short arrow per cell along its D8 flow direction (needs a field carrying `dir`).\n\nVector results (Marching Squares contours, watershed outlines) are polylines \u2014 send those to Polygon / Network, not here.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "matrix", label: "Matrix" },
      { key: "mode", label: "Mode" },
      { key: "lowColor", label: "Low colour" },
      { key: "highColor", label: "High colour" },
      { key: "cellSize", label: "Cell size" },
      { key: "originX", label: "Origin X" },
      { key: "originY", label: "Origin Y" },
      { key: "showCellValues", label: "Show cell values" }
    ]
  },
  parameters: [
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "heatmap",
      options: [
        { value: "heatmap", label: "Heatmap (scalar ramp)" },
        { value: "categorical", label: "Categorical (labels)" },
        { value: "arrows", label: "Arrows (flow direction)" }
      ]
    },
    { key: "lowColor", label: "Low colour", kind: "color", default: "#1e3a8a", showWhen: "mode == 'heatmap'" },
    { key: "highColor", label: "High colour", kind: "color", default: "#ef4444", showWhen: "mode == 'heatmap'" },
    { key: "cellSize", label: "Cell size (matrix)", kind: "number", default: 1, unit: "m" },
    { key: "originX", label: "Origin X (matrix)", kind: "number", default: 0, unit: "m" },
    { key: "originY", label: "Origin Y (matrix)", kind: "number", default: 0, unit: "m" },
    { key: "showCellValues", label: "Show cell values", kind: "checkbox", default: false }
  ]
};

// src/floorplan/flow/declarations/matrix-transpose.node.json
var matrix_transpose_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-transpose",
  meta: { label: "Transpose", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 transpose a matrix (A\u1D40): swap rows \u2194 columns. Matrix in, matrix out; draws nothing.",
  instructions: "A value-only node: a matrix as JSON in, its transpose as JSON out. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: wire a matrix into valin-matrix \u2014 Grid Geometry's `val-matrix` (a bare rows\xD7cols 2D array `[[\u2026],\u2026]`), or another Matrix node's output. A val-grid `{ \"values\": [[\u2026]] }` is accepted too.\n\nOUTPUT: `val-matrix` \u2014 the transpose; plus `val-rows` / `val-cols` (the result dimensions). Chain into Matrix Multiply / Inverse to build e.g. A\u1D40A or the least-squares normal equations x = (A\u1D40A)\u207B\xB9A\u1D40b. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "matrix", label: "Matrix" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" }
    ]
  },
  parameters: [
    { key: "matrix", label: "Matrix (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/matrix-inverse.node.json
var matrix_inverse_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-inverse",
  meta: { label: "Inverse", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 invert a SQUARE matrix (A\u207B\xB9) by Gauss\u2013Jordan elimination. Matrix in, matrix out; draws nothing. Non-square or singular input \u2192 empty.",
  instructions: "A value-only node: a SQUARE matrix as JSON in, its inverse as JSON out. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: wire a square matrix into valin-matrix \u2014 Grid Geometry's `val-matrix` (a bare n\xD7n 2D array `[[\u2026],\u2026]`), or another Matrix node's output (e.g. A\u1D40A from Transpose \u2192 Multiply). A val-grid `{ \"values\": [[\u2026]] }` is accepted too.\n\nMETHOD: Gauss\u2013Jordan elimination with partial pivoting. A non-square matrix, or a singular one (pivot \u2248 0), returns an EMPTY matrix \u2014 check `val-rows` > 0. Note: inverting A\u1D40A is the textbook least-squares step but numerically shaky for large / ill-conditioned systems (a QR-based Least Squares node is the robust alternative).\n\nOUTPUT: `val-matrix` \u2014 the inverse; plus `val-rows` / `val-cols`. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "matrix", label: "Matrix" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" }
    ]
  },
  parameters: [
    { key: "matrix", label: "Matrix (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/matrix-solve.node.json
var matrix_solve_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-solve",
  meta: { label: "Linear Solve", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 solve the linear system K\xB7d = F for d by Gauss\u2013Jordan elimination with partial pivoting. K is an n\xD7n matrix, F an n\xD7m right-hand side (one load column, or several). Matrices in, the solution d out; draws nothing. Singular / non-square / mismatched \u2192 empty.",
  instructions: "A value-only node: two matrices as JSON in (K and F), the solution d as JSON out. It has no geometry input or output and draws nothing on the canvas.\n\nWHAT IT COMPUTES: d such that K\xB7d = F. This is the classic linear-algebra solve, and the beating heart of the direct-stiffness / finite-element method \u2014 the 'solve Kd = F' step where K is the (reduced) global stiffness matrix, F the nodal load vector, and d the unknown nodal displacements.\n\nINPUTS:\n\u2022 valin-k \u2014 a SQUARE n\xD7n matrix (Grid Geometry's `val-matrix`, or any Matrix node's output \u2014 e.g. the assembled, boundary-reduced global stiffness K_ff).\n\u2022 valin-f \u2014 the right-hand side, n\xD7m. m = 1 is the usual single load case (an n\xD71 column); m > 1 solves several load cases at once (each column an independent RHS). A bare number is read as a 1\xD71.\n\nMETHOD: Gauss\u2013Jordan elimination with partial pivoting on the augmented [K | F]. Preferable to forming K\u207B\xB9 with the Inverse node and multiplying \u2014 it never builds the inverse, so it is cheaper and better-conditioned. A non-square K, a row-count mismatch (K.rows \u2260 F.rows), a ragged matrix, or a singular K (a zero pivot \u2014 e.g. an unrestrained mechanism whose stiffness matrix has a rigid-body mode) returns an EMPTY matrix, so check `val-rows` > 0.\n\nOUTPUT: `val-matrix` \u2014 the solution d (n\xD7m); plus `val-rows` / `val-cols`, and `val-value` = d[0][0] as a plain NUMBER so a single solved unknown can drive an ordinary numeric param. Wire d onward to recover member forces (k\xB7d) or, for an n\xD72 result, straight into a Polygon's `valin-points` to draw it. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "k", label: "Matrix K" },
      { key: "f", label: "RHS F" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Solution d (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" },
      { key: "value", label: "Value" }
    ]
  },
  parameters: [
    { key: "k", label: "Matrix K (JSON)", kind: "text", default: "" },
    { key: "f", label: "RHS F (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/least-squares.node.json
var least_squares_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "least-squares",
  meta: { label: "Least Squares", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 solve an OVER-determined system A\xB7x \u2248 b in the least-squares sense by Householder QR (the robust alternative to the normal equations, which square the condition number). A is m\xD7n with m \u2265 n, b is m\xD7k. Outputs the best-fit x and the residual. Draws nothing.",
  instructions: "A value-only node: two matrices as JSON in (A and b), the best-fit x as JSON out. It has no geometry input or output and draws nothing on the canvas.\n\nWHAT IT COMPUTES: the x that minimises \u2016A\xB7x \u2212 b\u2016 \u2014 the least-squares solution of A\xB7x \u2248 b. Use it whenever there are MORE equations than unknowns: fitting a line / polynomial / plane to many points, regression, calibrating a model against samples, or any over-determined constraint set.\n\nINPUTS:\n\u2022 valin-a \u2014 the design matrix A, m\xD7n with m \u2265 n (Grid Geometry's `val-matrix`, a point list's `val-points`, or another Matrix node). For a straight-line fit y = c\u2080 + c\u2081\xB7t, A is the m\xD72 matrix [1 | t].\n\u2022 valin-b \u2014 the observations b, m\xD7k. Usually a single m\xD71 column; several columns solve several right-hand sides (independent fits) at once. A bare number is read as 1\xD71.\n\nMETHOD: Householder QR. Reflections drive A \u2192 R (upper-triangular) and b \u2192 Q\u1D40b without ever forming Q, then R\xB7x = Q\u1D40b is back-substituted. This is preferable to the textbook normal equations x = (A\u1D40A)\u207B\xB9A\u1D40b (Transpose \u2192 Multiply \u2192 Inverse \u2192 Multiply): forming A\u1D40A squares the condition number, so QR keeps ~twice the accuracy on ill-scaled data. An UNDER-determined system (m < n \u2014 infinitely many solutions, the minimum-norm / SVD case), a row-count mismatch (A.rows \u2260 b.rows), ragged input, or a rank-deficient A (a zero pivot in R) returns an EMPTY matrix \u2014 check `val-rows` > 0.\n\nOUTPUTS:\n\u2022 `val-matrix` \u2014 the solution x (n\xD7k); plus `val-rows` / `val-cols`, and `val-value` = x[0][0] as a plain NUMBER.\n\u2022 `val-residual` \u2014 the residual norm \u2016A\xB7x \u2212 b\u2016 (0 for an exact fit), the single-number measure of how well the model fits.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "a", label: "Matrix A" },
      { key: "b", label: "RHS b" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Solution x (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" },
      { key: "value", label: "Value" },
      { key: "residual", label: "Residual \u2016Ax\u2212b\u2016" }
    ]
  },
  parameters: [
    { key: "a", label: "Matrix A (JSON)", kind: "text", default: "" },
    { key: "b", label: "RHS b (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/matrix-ops.node.json
var matrix_ops_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-ops",
  meta: { label: "Matrix Operations", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 combine TWO matrices into one: A+B, A\u2212B, A\xB7B (matrix product), A\u2218B (element-wise \xD7) or A/B. Element-wise ops BROADCAST, so a scalar or an N\xD71 column combines with an N\xD72 vector list. Draws nothing.",
  instructions: "A value-only node: two matrices as JSON in, one matrix as JSON out. It has no geometry input or output and draws nothing on the canvas.\n\nINPUTS: wire a matrix into valin-a and valin-b \u2014 Grid Geometry's `val-matrix` (a bare rows\xD7cols 2D array `[[\u2026],\u2026]`), another Matrix / Vector node's output, or a POINT LIST such as Space Geometry's / Polygon's `val-points` (an N\xD72 list IS an N-row matrix \u2014 that is how this reaches real geometry). A val-grid `{ \"values\": [[\u2026]] }` is accepted too. A bare NUMBER wired in (e.g. an Input Properties slider) is read as a 1\xD71 matrix so it broadcasts.\n\nOPERATIONS:\n\u2022 Add (A+B) / Subtract (A\u2212B) \u2014 element-wise.\n\u2022 Multiply (A\xB7B) \u2014 the MATRIX PRODUCT (rows of A dotted with columns of B). Requires A's cols = B's rows; the result is A.rows \xD7 B.cols. Order matters \u2014 A\xB7B \u2260 B\xB7A. NOT broadcast.\n\u2022 Multiply element-wise (A\u2218B) \u2014 the Hadamard product, cell-by-cell.\n\u2022 Divide (A/B) \u2014 element-wise. Division by \u22480 yields 0 rather than Infinity, so one degenerate cell can't poison the whole list.\n\nBROADCASTING (all element-wise ops): a dimension must MATCH or be 1, in which case it stretches. So N\xD72 with 1\xD71 scales every component by a scalar, and N\xD72 with N\xD71 applies a PER-ROW scalar (exactly the miter-vector divide B / (1 + n\u0302\xB7n\u0302\u209A)).\n\nIncompatible shapes, a ragged matrix, or empty input return an EMPTY matrix \u2014 check `val-rows` > 0.\n\nOUTPUT: `val-matrix` \u2014 the result; plus `val-rows` / `val-cols`. Transpose \u2192 Matrix Operations (A\xB7B) gives A\u1D40A, and feeding that to Inverse builds the least-squares normal equations x = (A\u1D40A)\u207B\xB9A\u1D40b. An N\xD72 result can be wired straight into a Polygon node's `valin-points` to DRAW it. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "a", label: "Matrix A" },
      { key: "b", label: "Matrix B" },
      { key: "op", label: "Operation" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" },
      { key: "value", label: "Value" }
    ]
  },
  parameters: [
    {
      key: "op",
      label: "Operation",
      kind: "select",
      default: "multiply",
      options: [
        { value: "add", label: "Add (A + B)" },
        { value: "subtract", label: "Subtract (A \u2212 B)" },
        { value: "multiply", label: "Multiply (A \xB7 B)" },
        { value: "hadamard", label: "Multiply element-wise (A \u2218 B)" },
        { value: "divide", label: "Divide element-wise (A / B)" }
      ]
    },
    { key: "a", label: "Matrix A (JSON)", kind: "text", default: "" },
    { key: "b", label: "Matrix B (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/matrix-shift.node.json
var matrix_shift_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-shift",
  meta: { label: "Shift Rows", category: "Grid", color: "#0e7490" },
  description: `A pure CALCULATION node \u2014 cyclically roll a matrix's ROWS. This is how you say "neighbour" for a vertex list: shift by -1 lines each vertex up with its NEXT one, by +1 with its PREVIOUS. Draws nothing.`,
  instructions: "A value-only node: a matrix in, the same matrix with its rows rotated, out. It has no geometry input or output and draws nothing on the canvas.\n\nWHY IT EXISTS: anything defined BETWEEN adjacent vertices \u2014 edge vectors, turn angles, curvature, corner bisectors \u2014 needs each row paired with its neighbour. Rolling the rows lets you express that with plain matrix arithmetic instead of a Loop.\n\nINPUT: wire a matrix into valin-matrix \u2014 typically a POINT LIST (`val-points` from Polygon / Space Geometry / Vertices, an N\xD72 array of [x, y] metre pairs).\n\nSHIFT BY: an integer, wrapping around the ends (the list is treated as a closed ring, which is what a polygon is).\n\u2022 -1 \u2192 each row holds its NEXT neighbour. `Shift(P, -1) \u2212 P` via Matrix Operations (Subtract) is the EDGE-VECTOR list.\n\u2022 +1 \u2192 each row holds its PREVIOUS neighbour (the edge arriving at that vertex).\n\nOUTPUT: `val-matrix` (same shape as the input) plus `val-rows` / `val-cols`. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "matrix", label: "Matrix" },
      { key: "by", label: "Shift by" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" }
    ]
  },
  parameters: [
    { key: "by", label: "Shift by (rows)", kind: "number", default: -1, step: 1 },
    { key: "matrix", label: "Matrix (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/vector-ops.node.json
var vector_ops_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "vector-ops",
  meta: { label: "Vector Ops", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 row-wise vector maths on an N\xD72 list: Normalize, Length, Perpendicular, Negate, Angle. An N\xD72 matrix IS a list of N 2D vectors, so this reuses the matrix type. Draws nothing.",
  instructions: "A value-only node: a LIST OF VECTORS in, a list out. Every row is treated as one vector and handled independently, so a whole polygon's worth of edges is processed in one pass \u2014 no Loop needed. It has no geometry input or output and draws nothing on the canvas.\n\nTHE TYPE: an N\xD72 matrix and a list of N 2D vectors are the same thing, so this node consumes anything the Matrix nodes produce \u2014 including a point list (`val-points`) or an edge-vector list (Shift Rows \u2192 Matrix Operations Subtract). A single vector is just the N = 1 case. N\xD73 works too where the operation is defined in 3D.\n\nOPERATIONS:\n\u2022 Normalize (v\u0302) \u2014 unit length, direction only. A zero-length row stays zero instead of becoming NaN.\n\u2022 Length (|v|) \u2014 reduces to an N\xD71 column. Feed it back in as a per-row scalar via Matrix Operations (broadcasting).\n\u2022 Perpendicular (CCW) \u2014 rotate 90\xB0, (x, y) \u2192 (\u2212y, x). For a COUNTER-CLOCKWISE ring this is the INWARD edge normal, which is what offsetting needs. 2D only (reads the first two columns).\n\u2022 Perpendicular (CW) \u2014 (x, y) \u2192 (y, \u2212x); the outward normal for a CCW ring.\n\u2022 Negate (\u2212v) \u2014 reverse direction.\n\u2022 Angle \u2014 atan2(y, x) in DEGREES, reduces to an N\xD71 column.\n\nOUTPUT: `val-matrix` plus `val-rows` / `val-cols`. Chain with Vector Product (dot / cross) and Matrix Operations to build geometric formulas directly in the graph. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "a", label: "Vectors" },
      { key: "op", label: "Operation" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" }
    ]
  },
  parameters: [
    {
      key: "op",
      label: "Operation",
      kind: "select",
      default: "normalize",
      options: [
        { value: "normalize", label: "Normalize (v\u0302)" },
        { value: "length", label: "Length (|v|)" },
        { value: "perp", label: "Perpendicular CCW (\u2212y, x)" },
        { value: "perp-cw", label: "Perpendicular CW (y, \u2212x)" },
        { value: "negate", label: "Negate (\u2212v)" },
        { value: "angle", label: "Angle (degrees)" }
      ]
    },
    { key: "a", label: "Vectors (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/vector-product.node.json
var vector_product_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "vector-product",
  meta: { label: "Vector Product", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 row-wise Dot, Cross and Angle Between for two vector lists. Dot measures alignment; the 2D cross is a SIGNED scalar whose sign is the left/right turn test. Draws nothing.",
  instructions: "A value-only node: two LISTS OF VECTORS in, one result column out. Row i of A is paired with row i of B, so a whole polygon is processed in one pass. Shapes BROADCAST, so a single vector (1\xD72) can be measured against an entire list. It has no geometry input or output and draws nothing on the canvas.\n\nOPERATIONS:\n\u2022 Dot (a \xB7 b) = |a||b|cos \u03B8 \u2192 an N\xD71 column. Alignment and projection: positive means the two point the same way, 0 means perpendicular, negative means opposing. This is the workhorse \u2014 closest point on a wall, decomposing a force along/across an axis, and solar incidence (a facade normal dotted with the sun direction).\n\u2022 Cross (a \xD7 b) \u2014 in 2D the SIGNED scalar a\u2093b_y \u2212 a_yb_x \u2192 an N\xD71 column. Its magnitude is the parallelogram area, but the useful part is the SIGN: positive = left turn, negative = right turn. That single fact gives you polygon winding (sum it around a ring), convex vs reflex at each vertex, and which side of a wall a point falls on. In 3D it returns the N\xD73 normal vector instead.\n\u2022 Angle Between \u2014 atan2(cross, dot) in DEGREES \u2192 an N\xD71 column. SIGNED in 2D (so it carries the turn direction) and unsigned in 3D. Preferred over acos(dot), which loses precision near 0\xB0 and 180\xB0 and throws away the sign.\n\nINPUTS: wire vector lists into valin-a and valin-b \u2014 a point list (`val-points`), an edge-vector list (Shift Rows \u2192 Matrix Operations Subtract), or normals from Vector Ops.\n\nOUTPUT: `val-matrix` plus `val-rows` / `val-cols`. An N\xD71 result feeds straight back into Matrix Operations as a PER-ROW scalar (broadcasting). Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "a", label: "Vectors A" },
      { key: "b", label: "Vectors B" },
      { key: "op", label: "Operation" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" }
    ]
  },
  parameters: [
    {
      key: "op",
      label: "Operation",
      kind: "select",
      default: "dot",
      options: [
        { value: "dot", label: "Dot (a \xB7 b)" },
        { value: "cross", label: "Cross (a \xD7 b)" },
        { value: "angle", label: "Angle Between (degrees)" }
      ]
    },
    { key: "a", label: "Vectors A (JSON)", kind: "text", default: "" },
    { key: "b", label: "Vectors B (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/matrix-to-graph.node.json
var matrix_to_graph_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-to-graph",
  meta: {
    label: "Points to Graph",
    category: "Graph",
    color: "#0e7490"
  },
  description: "A pure CALCULATION node \u2014 turn point MATRICES into graph JSON. This is the bridge out of the matrix chain: an N\xD72 matrix has positions but no connectivity, a graph has edges. Wire the result into Network to draw it.",
  instructions: 'A value-only node: one or two point matrices in, a graph as JSON out. It has no geometry input or output and draws nothing itself \u2014 wire `val-graph` into a Network node (or Merge Graph / Graph Reduce / Mitered Join) to see it.\n\nWHY IT EXISTS: every matrix node speaks `[[x,y],\u2026]`, which carries positions but no edges. Network needs { nodes: [{id,x,y}], edges: [{from_node_id,to_node_id}] }. This node adds the connectivity.\n\nINPUTS: wire point lists into valin-a and valin-b \u2014 `val-points` from Space Geometry / Polygon / Vertices, or any N\xD72 `val-matrix` from the Matrix and Vector nodes.\n\nMODES:\n\u2022 Pairs (A \u2192 B) \u2014 one edge per row, from A[i] to B[i]. Both inputs required, and the row count is the shorter of the two. This is the mode for drawing a family of rays or spokes (e.g. each polygon vertex to its offset position).\n\u2022 Ring (closed) \u2014 A[0]\u2192A[1]\u2192\u2026\u2192A[n-1]\u2192A[0]. Draws a point list as a closed outline.\n\u2022 Path (open) \u2014 A[0]\u2192A[1]\u2192\u2026\u2192A[n-1], no closing edge.\n\u2022 Points only \u2014 nodes, no edges.\n\nCOINCIDENT POINTS MERGE: positions are keyed to the millimetre, so two rows landing on the same spot become ONE graph node. That is what makes converging rays read as a connected skeleton rather than a bundle of separate spokes, and it drops any edge whose two ends have collapsed together.\n\nPER-EDGE THICKNESS: wire an N\xD71 COLUMN into valin-thickness (metres, row i = edge i \u2014 the same row that produced the edge) and every edge carries its own `thickness`. A single scalar broadcasts to all edges; leave it empty and no thickness is written at all. This is how one graph holds a 0.23 m exterior wall and a 0.1 m interior wall at once, instead of needing Set Thickness per family.\n\nEDGE TYPE: the optional Edge type param stamps `type` on every edge produced here \u2014 "wall", "door", "window" or "opening". Merge Graph preserves it, so a wall graph, a door graph and a window graph union into ONE graph whose edges stay distinguishable downstream. Mitered Join and Graph to Matrix SKIP `type: "opening"` edges, so use "door" / "window" when the openings should still be stroked.\n\nOUTPUT: `val-graph` plus `val-nodeCount` / `val-edgeCount` (what actually survived the merge). Every parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "a",
        label: "Points A"
      },
      {
        key: "b",
        label: "Points B"
      },
      {
        key: "mode",
        label: "Mode"
      },
      {
        key: "thickness",
        label: "Thickness (per edge)"
      },
      {
        key: "types",
        label: "Edge type codes (per edge)"
      },
      {
        key: "type",
        label: "Edge type"
      }
    ],
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  parameters: [
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "pairs",
      options: [
        {
          value: "pairs",
          label: "Pairs (A[i] \u2192 B[i])"
        },
        {
          value: "ring",
          label: "Ring (closed outline)"
        },
        {
          value: "path",
          label: "Path (open chain)"
        },
        {
          value: "points",
          label: "Points only (no edges)"
        }
      ]
    },
    {
      key: "a",
      label: "Points A (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "b",
      label: "Points B (JSON)",
      kind: "text",
      default: "",
      showWhen: "mode == 'pairs'"
    },
    {
      key: "thickness",
      label: "Thickness column (JSON, m)",
      kind: "text",
      default: ""
    },
    {
      key: "type",
      label: "Edge type",
      kind: "select",
      default: "",
      options: [
        {
          value: "",
          label: "(none)"
        },
        {
          value: "wall",
          label: "Wall"
        },
        {
          value: "wall-exterior",
          label: "Wall \u2014 exterior"
        },
        {
          value: "wall-interior",
          label: "Wall \u2014 interior"
        },
        {
          value: "door",
          label: "Door"
        },
        {
          value: "window",
          label: "Window"
        },
        {
          value: "opening",
          label: "Opening (skipped by Mitered Join)"
        }
      ]
    },
    {
      key: "types",
      label: "Edge type codes (per edge)",
      kind: "text",
      default: "",
      placeholder: "[[1],[1],[2],[3]]"
    },
    {
      key: "typeNames",
      label: "Type names for those codes",
      kind: "text",
      default: "",
      placeholder: '["wall-exterior","wall-interior","door","window"]'
    }
  ]
};

// src/floorplan/flow/declarations/render-2d.node.json
var render_2d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "render-2d",
  meta: {
    label: "2D Render",
    category: "2d primitives",
    color: "#0891b2"
  },
  description: "Draw ANY number of 2D primitives from one node \u2014 add a row per kind (Polygon, Circle, Stroke), each with its own colour, layer and input endpoint. The drawing counterpart of Input Properties.",
  instructions: "One node for the whole 2D output of an operation. Press \"Add primitive\" for a row, pick its KIND, and wire the geometry into that row's own `valin-<rowId>` endpoint on the left. Everything that is not a number \u2014 colour, layer name \u2014 lives on the row, because a Math Engine can only put numbers on a wire.\n\nA ROW IS A STYLE GROUP, NOT A SHAPE. Fed a list with many entries, one row draws many pieces in its colour and layer, so a computed result of any size needs ONE row \u2014 not one node per shape. That is what replaces a chain of Polygon nodes.\n\nKINDS\n\u2022 POLYGON \u2014 takes a vertex list. `[[x,y],\u2026]` is one outline; `[[[x,y],\u2026],\u2026]` is several; and a FLAT list whose rows carry a THIRD column splits into one outline per run of equal third value (the group column a Math Engine emits with `hcat(pts, fill(rows(pts),1,i))`). Vertex counts may differ from piece to piece. A grouped list is read EVEN-ODD, so a ring nested inside another is a HOLE rather than a second filled patch \u2014 which is what makes the Math Engine's `subtract(outline, cutters)` drawable directly: an outer boundary plus its holes arrives as one grouped list and draws with the holes voided. Disjoint rings still fill individually. A STROKE row is deliberately NOT read this way: its bands are independent quads, and two that overlapped would cancel instead of merging.\n\u2022 CIRCLE \u2014 takes a CENTRE list and draws one circle per point: `[[x,y],\u2026]` at the row's Radius, or `[[x,y,r],\u2026]` to give every circle its own radius from the third column. Circles are emitted as sampled outlines (64 segments), so they behave like any other Space downstream.\n\n\u2022 STROKE \u2014 takes a SEGMENT list `[[x1,y1,x2,y2],\u2026]` and thickens each segment into a band of the row's Width about its centreline; a FIFTH column gives a segment its own width, exactly as Circle's third column gives a circle its own radius. The open-path row: Polygon and Circle can only draw a CLOSED ring, so a centreline \u2014 a frame member, a pipe run, a bar, a 3D Tube's plan projection \u2014 had to be widened into a quad by hand before it could be drawn. Segments are stroked INDEPENDENTLY, with no join between them: for a continuous mitred outline use the Mitered Join node. A zero-length segment is dropped rather than drawn as a spike, which is what a vertical 3D member projects to in plan.\nCOORDINATES are anchor-relative metres \u2014 the same frame `val-points` uses everywhere else, so a Space source's outline, a Math Engine's result and a Polygon node's echo all drop straight in.\n\nEACH ROW ALSO PUBLISHES what it resolved on `val-<rowId>`, so a rendered piece can still feed a Boolean 2D, a Merge or another operation.\n\nLAYER: names the canvas layer this row's pieces are rendered on (Flow Live). Blank falls back to the node's own layer. Several rows may share one name.\n\nWHAT THIS DOES NOT REPLACE: the single-purpose generators (Rectangle, Ngon, Ellipse \u2026). Those are for hand-authoring, where a width/height slider is the point. This node is for geometry that arrives computed.",
  handles: {
    input: false,
    output: true
  },
  defaults: {
    prims: [
      {
        id: "pr1",
        kind: "polygon",
        name: "",
        color: "#0891b2",
        layer: "",
        show: true
      }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/render-3d.node.json
var render_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "render-3d",
  meta: {
    label: "3D Render",
    category: "3d primitives",
    color: "#0e7490"
  },
  description: "Build ANY number of 3D solids from one node \u2014 add a row per kind (Cuboid, Cylinder, Sphere, Cone, Capsule, Frustum, Tapered Box, Torus, Polyhedron, Tube, Ring, Loft), each with its own dimensions, position, colour and input endpoint. The 3D twin of the 2D Render node, and the single entry point for 3D geometry.",
  instructions: "One node for the whole 3D output of an operation. Press \"Add primitive\" for a row, pick its KIND, set its dimensions, and \u2014 optionally \u2014 wire a POSITION LIST into that row's own `valin-<rowId>` endpoint on the left.\n\nA ROW IS A STYLE GROUP, NOT A SOLID. With nothing wired, a row builds ONE solid at its own X / Y / Z. Wire it a list and it builds one solid PER POINT, all sharing the row's dimensions and colour:\n\u2022 `[[x,y],\u2026]` \u2014 one solid per point, at the row's Z.\n\u2022 `[[x,y,z],\u2026]` \u2014 a third column gives each solid its own base elevation.\nSo a Math Engine that computes twelve column positions needs ONE row, not twelve Cuboid nodes.\n\nKINDS\n\u2022 CUBOID \u2014 Length \xD7 Breadth \xD7 Height.\n\u2022 CYLINDER \u2014 Radius + Height.\n\u2022 SPHERE \u2014 Radius, resting on the floor at Y=0.\n\u2022 CONE \u2014 Radius + Height, base on the floor.\n\u2022 CAPSULE \u2014 a pill: Radius caps on a straight middle of Length, so it stands Length + 2 \xD7 Radius tall.\n\u2022 FRUSTUM \u2014 a tapered cylinder: Radius at the bottom \u2192 Top radius over Height. Equal radii give a cylinder, a top of 0 gives a cone.\n\u2022 TAPERED BOX \u2014 a rectangular frustum: Length \xD7 Breadth at the bottom \u2192 Top length \xD7 Top breadth over Height.\n\u2022 TORUS \u2014 a donut lying FLAT: Radius is the ring (hole centre \u2192 tube centre), Tube radius the section, Arc\xB0 the sweep (360 closes it, less leaves an open arc \u2014 a partial ring with no boolean). Positioned by a point; use RING instead when the axis is computed.\n\u2022 POLYHEDRON \u2014 no dimensions at all: the wired FACE LIST is the entire solid, exactly as the 2D Polygon row's vertex list is the entire outline. This is the kind to use when the SHAPE itself is computed, because a Cuboid row's Length / Breadth / Height are fixed numbers that no wire can reach \u2014 a Math Engine that derives a solid from its parameters emits it here and the mesh stays parametric.\n\u2022 TUBE \u2014 a capped cylinder along a wired AXIS SEGMENT, one per row of the list. Radius comes from the row; a SEVENTH column gives a segment its own radius.\n\u2022 RING \u2014 a torus whose AXIS is the wired segment: centred on the segment's MIDPOINT and lying in the plane perpendicular to it. Only the segment's direction and midpoint are read \u2014 its length is free \u2014 so a wheel is driven by its axle. Radius is the ring (hole centre \u2192 tube centre) and Tube radius the section; a SEVENTH column overrides the ring radius per segment and an EIGHTH the section.\n\u2022 LOFT \u2014 the SKIN over a stack of cross-sections. It reads the same grouped point list a Polyhedron row does, but a run of equal group value is a SECTION, not a finished face: consecutive sections are stitched quad by quad and both ends are capped. This is the row for a curved BODY \u2014 a car, a boat hull, a roof, a moulding, a tapered column. Polyhedron can draw any of those, but only if the Math Engine enumerates every face, which means hand-writing the same stitching loop (k \u2192 k+1 around the ring, i \u2192 i+1 along the body, the wrap-around, the two caps) in every flow that lofts anything. What actually varies between one lofted thing and the next is the SECTIONS, so that is all a flow authors. Sections should share a vertex count; where two differ they are stitched over the smaller, so a mismatch loses detail rather than the solid. Rings close automatically \u2014 do not repeat the first point. Fewer than two usable sections draws nothing.\n\nTHE TUBE / RING WIRE FORMAT \u2014 an AXIS-SEGMENT list `[[x1,y1,z1,x2,y2,z2],\u2026]`, one segment per solid, in the same plan-frame metres everything else uses. These two are the only rows that carry their own ORIENTATION: a Cuboid / Cylinder row is positioned by a POINT and its axis is fixed vertical, and the row exposes no rotation for a wire to reach, so every off-axis member \u2014 a raked fork, a diagonal strut, a handrail, a wheel standing on edge \u2014 was previously unbuildable except by hand-authoring its faces into a Polyhedron row. A tilted segment needs no special case: the perpendicular frame is derived from the segment itself, so a vertical seat tube and a raked fork take the same path. Internally each row is emitted as a face list on the Polyhedron path, so the viewport, the 3D export and any downstream Display 3D treat it identically. A degenerate (zero-length) segment is skipped, and a row with nothing parseable wired draws nothing.\n\nTHE POLYHEDRON WIRE FORMAT \u2014 a list of FACES, each an ordered ring of 3D points (metres, plan frame). Two shapes, mirroring the Polygon row one-for-one:\n\u2022 NESTED `[[[x,y,z],\u2026],\u2026]` \u2014 one inner array per face.\n\u2022 FLAT `[[x,y,z,f],\u2026]` \u2014 one face per run of equal FOURTH value, the group column a Math Engine writes with `hcat(ring, fill(rows(ring),1,f))`. A 3-column flat list with no group column is a single face.\nRings may have any vertex count and differ face to face; each is fan-triangulated and drawn double-sided, so winding direction doesn't matter. A ring of fewer than 3 points is dropped, and a row with nothing parseable wired draws nothing (unlike Cuboid / Cylinder, it has no fallback shape of its own).\nA closed box is 6 rings of 4 points; a whole assembly is just more rings in the same list, so ONE row can carry a nine-part piece of furniture \u2014 see Workflows/Miscellaneous/bed-flow.json, which builds all nine boxes in a Math Engine loop.\nX / Y / Z on a Polyhedron row are an OFFSET applied to the finished mesh (its vertices are already absolute), not a position the shape is built at.\n\nCOORDINATES are metres in the same plan frame the 2D side uses (X across, Y down the plan, Z up), matching a wired `val-points` list exactly, so the solids land over the geometry that generated them.\n\nCOLOUR is per row. LAYER is kept on the row as a label only \u2014 the 3D scene has no canvas layers; its styling is this colour plus any downstream Display 3D node.\n\nWHAT THIS DOES NOT REPLACE: the single-purpose 3D primitives (Cuboid, Cylinder, Sphere, Cone, Frustum \u2026) with their transform / boolean / display chain. Those stay the way to hand-model one solid with full control. This node is for solids that arrive computed \u2014 one row, many instances.",
  handles: {
    input: false,
    output: true
  },
  defaults: {
    prims: [
      {
        id: "pr1",
        kind: "cuboid",
        name: "",
        color: "#94a3b8",
        layer: "",
        length: 3,
        breadth: 2,
        height: 3,
        z: 0,
        show: true
      }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/export-dxf.node.json
var export_dxf_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "export-dxf",
  meta: { label: "Export DXF", category: "Output", color: "#475569" },
  description: "Write the incoming 2D geometry to an AutoCAD DXF (R12) and download it \u2014 the drawing counterpart of Export 3D. Wire a 2D Render node in and each of its rows becomes a layer.",
  instructions: `A SINK: wire any 2D geometry into its input and press Download .dxf. Nothing is drawn on canvas and nothing is committed \u2014 the node is invisible to the flow apart from the file it writes.

WIRE A 2D RENDER NODE IN and the export is fully described by the render rows: every row's outlines go out as closed POLYLINEs on a layer named after that row's Layer field, in the nearest AutoCAD pen colour to the row's colour, and a CIRCLE row can go out as true CIRCLE entities instead of a 64-sided polygon. Any other 2D node (Polygon, Mitered Join, Boolean 2D, BSP \u2026) exports too \u2014 it simply has one layer instead of several.

COORDINATES are measured from the flow anchor, not from wherever the canvas happens to sit, so the drawing opens around the origin. Plan Y points DOWN; "Y up (CAD)" flips it so the DXF reads the right way up in AutoCAD / LibreCAD / QCAD, which is what you almost always want.

UNITS scale the metre coordinates on the way out \u2014 the file itself carries no unit, so pick what the receiving drawing expects (millimetres for most production CAD).`,
  handles: {
    input: true,
    output: false
  },
  parameters: [
    { key: "fileName", label: "File name", kind: "text", default: "flow-export", placeholder: "flow-export" },
    {
      key: "units",
      label: "Units",
      kind: "select",
      default: "m",
      options: [
        { value: "m", label: "Metres" },
        { value: "cm", label: "Centimetres" },
        { value: "mm", label: "Millimetres" },
        { value: "ft", label: "Feet" }
      ]
    },
    { key: "yUp", label: "Y up (CAD)", kind: "checkbox", default: true },
    {
      key: "layerMode",
      label: "Layers from",
      kind: "select",
      default: "row",
      options: [
        { value: "row", label: "Render row layer" },
        { value: "node", label: "Source node" },
        { value: "single", label: "One layer" }
      ]
    },
    { key: "layerName", label: "Layer name", kind: "text", default: "FLOW", placeholder: "FLOW", showWhen: "layerMode == 'single'" },
    { key: "circleEntities", label: "True circles", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/export-3d.node.json
var export_3d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "export-3d",
  meta: { label: "Export 3D", category: "Output", color: "#475569" },
  description: "Write the incoming 3D solids to a mesh file (glTF / OBJ / STL / PLY) and download it \u2014 the 3D twin of Export DXF. Wire a 3D Render node in and every row it built is exported.",
  instructions: `A SINK: wire any 3D geometry into its input and press Download. Nothing is added to the scene and nothing is committed \u2014 the node only writes the file.

WIRE A 3D RENDER NODE IN and every solid its rows built is exported, exactly as the viewport shows it: Cuboid and Cylinder rows with their dimensions and per-point placements, Polyhedron rows with their computed face lists. A single 3D primitive (Cuboid, Cylinder, Sphere, Frustum \u2026) with its Transform 3D chain exports the same way.

FORMAT decides what survives:
\u2022 glTF (.glb) \u2014 geometry AND colour, one self-contained binary. The default, and what to use for Blender / three.js / AR.
\u2022 Wavefront (.obj) \u2014 geometry only (three's OBJ writer emits no material file), but the most widely accepted CAD interchange.
\u2022 STL (.stl) \u2014 triangles only, no colour: 3D printing.
\u2022 PLY (.ply) \u2014 geometry with per-vertex colour.

AXIS: the viewport is Y-up. "Z up" rotates the export so Z is up and +Y is north \u2014 the convention CAD and Blender expect, and the one the DXF export writes, so a 2D and a 3D export of the same object line up. Choose "Y up" only for a glTF/three.js pipeline that expects the raw scene frame.

UNITS scale the metre coordinates on the way out.`,
  handles: {
    input: true,
    output: false
  },
  parameters: [
    { key: "fileName", label: "File name", kind: "text", default: "flow-export", placeholder: "flow-export" },
    {
      key: "format",
      label: "Format",
      kind: "select",
      default: "glb",
      options: [
        { value: "glb", label: "glTF (.glb)" },
        { value: "obj", label: "Wavefront (.obj)" },
        { value: "stl", label: "STL (.stl)" },
        { value: "ply", label: "PLY (.ply)" }
      ]
    },
    {
      key: "units",
      label: "Units",
      kind: "select",
      default: "m",
      options: [
        { value: "m", label: "Metres" },
        { value: "cm", label: "Centimetres" },
        { value: "mm", label: "Millimetres" },
        { value: "ft", label: "Feet" }
      ]
    },
    {
      key: "axis",
      label: "Up axis",
      kind: "select",
      default: "z-up",
      options: [
        { value: "z-up", label: "Z up (CAD)" },
        { value: "y-up", label: "Y up (scene)" }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/export-canvas.node.json
var export_canvas_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "export-canvas",
  meta: { label: "Export to Canvas", category: "Output", color: "#0f766e" },
  description: "Write the incoming 2D geometry onto the canvas as ordinary Spaces and segments \u2014 the drawing counterpart of Export DXF, writing to the plan instead of to a file. Previews live while the eye is open; Commit makes it permanent.",
  instructions: "A SINK with a button. Wire any 2D geometry into its input and the node shows what it would write, ON THE CANVAS, as real Spaces and segments \u2014 no Flow Live toggle involved. Press COMMIT to make that geometry permanent.\n\nTHE EYE IS THE PREVIEW. While the eye in the node's title bar is open, the incoming geometry is materialised on the plan and tracks the flow: change a parameter upstream and it follows. It is still preview \u2014 it belongs to the flow, is not part of the drawing's history, and vanishes the moment you close the eye or delete the node. Close the eye to see the plan without it.\n\nCOMMIT HANDS IT OVER. Pressing Commit writes the same geometry as ORDINARY canvas data the flow no longer owns: it stops tracking the flow, becomes an undoable step in the drawing, and the live preview for that node steps aside so you are not looking at two copies. Move it, edit it, delete it \u2014 the flow will not fight you.\n\nHOW IT DIFFERS FROM THE OTHER TWO ROUTES. Flow Live materialises tracked geometry for the whole graph at once. Run Flow replays recipe OPERATIONS (inset, split, optimise) against a selected Space. This node does neither \u2014 it takes the geometry as it stands and puts it down, so nodes with no recipe equivalent (Boolean 2D, Mitered Join, Graph to Openings, a Math-Engine result) can reach the canvas at all.\n\nWIRE A 2D RENDER NODE IN and each row is written separately, keeping the row's colour and its Layer field (Layers from \u2192 Render row). Any other 2D node writes its single output instead.\n\nRE-COMMITTING replaces what the previous Commit wrote (matched by a stamp id on the target layer) rather than piling up duplicates \u2014 hand-drawn geometry sharing the layer is left alone. Switch Mode to Append to keep every press.\n\nOPEN geometry (skeletons, graph centrelines, dimension lines) has no interior, so it becomes segments only; closed rings become a Space with its boundary segments, and a ring nested inside another becomes a hole.",
  handles: {
    input: true,
    output: false
  },
  parameters: [
    {
      key: "layerMode",
      label: "Layers from",
      kind: "select",
      default: "single",
      options: [
        { value: "single", label: "One layer" },
        { value: "row", label: "Render row layer" }
      ]
    },
    { key: "layerName", label: "Layer name", kind: "text", default: "Flow Export", placeholder: "Flow Export", showWhen: "layerMode == 'single'" },
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "replace",
      options: [
        { value: "replace", label: "Replace previous" },
        { value: "append", label: "Append" }
      ]
    },
    { key: "makeSpaces", label: "Create Spaces", kind: "checkbox", default: true },
    { key: "makeWalls", label: "Create segments", kind: "checkbox", default: true },
    { key: "thickness", label: "Segment thickness (m)", kind: "number", default: 0.1, min: 0.01, max: 2, step: 0.01, showWhen: "makeWalls == true" },
    { key: "showLabel", label: "Show Space labels", kind: "checkbox", default: false, showWhen: "makeSpaces == true" }
  ]
};

// src/floorplan/flow/declarations/graph-to-matrix.node.json
var graph_to_matrix_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-to-matrix",
  meta: { label: "Graph to Points", category: "Graph", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 the inverse of Points to Graph. Graph JSON in, point MATRICES out: every edge as its start point, its end point and its thickness, plus the node positions. This is the bridge INTO the matrix chain.",
  instructions: "A value-only node: a graph as JSON in, matrices out. It has no geometry input or output and draws nothing \u2014 wire the outputs into a Math Engine, or into Matrix / Vector nodes.\n\nWHY IT EXISTS: Points to Graph is the bridge OUT of the matrix chain (positions \u2192 connectivity). This is the way back IN. A graph JSON is an OBJECT, so wiring it into a Math Engine variable gives you an inert string \u2014 nothing to compute with. Split into matrices, an edge list is ordinary linear algebra: `Gb - Ga` is the edge-vector list, `normalize(Gb - Ga)` its directions, `len(Gb - Ga)` its lengths, and a pairwise test on `vcat(Ga, Gb)` recovers which endpoints are the same node.\n\nOUTPUTS, all in the same anchor-relative METRES as Space Geometry's val-points, so they wire straight back into Polygon / Network:\n\u2022 `a` \u2014 M\xD72, each edge's START point (from_node_id).\n\u2022 `b` \u2014 M\xD72, each edge's END point (to_node_id). Row i of a and b is edge i, which is exactly what Points to Graph's Pairs mode consumes, so the pair round-trips.\n\u2022 `thickness` \u2014 M\xD71 metres per edge, 0 where the edge carries none. Set Thickness / Merge Graph / Graph Geometry publish it; a flow can then stroke each edge at its own width.\n\u2022 `nodes` \u2014 N\xD72, the node positions in the graph's own order.\n\u2022 `nodeCount` / `edgeCount` \u2014 the two counts, for driving a loop bound or a numeric param.\nAn edge naming a node the graph doesn't define is skipped, so the three edge outputs always agree row for row.\n\nSKIP OPENINGS (on by default): edges tagged `type: \"opening\"` \u2014 what Graph to Openings carves for a door or a window \u2014 are left out, matching what Mitered Join does with them. Turn it off to get every edge including the openings.\n\nNODE IDENTITY is NOT carried: matrices hold numbers, not ids. Two edges meeting at a node have IDENTICAL coordinates in their a/b rows, so recover the junction with a coordinate test \u2014 `min(where(le(D2, tol*tol), T(k), BIG), 'rows')` over the pairwise distance matrix of `vcat(a, b)` gives every endpoint the row index of its first coincident partner, i.e. a canonical node id per endpoint. See Workflows/Operations/mitered_join_with_math.json.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "graph", label: "Graph (JSON)" }
    ],
    valueOutputs: [
      { key: "a", label: "Edge start points" },
      { key: "b", label: "Edge end points" },
      { key: "thickness", label: "Edge thickness (m)" },
      { key: "nodes", label: "Node points" },
      { key: "nodeCount", label: "Nodes" },
      { key: "edgeCount", label: "Edges" }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "skipOpenings",
      label: "Skip opening edges",
      kind: "checkbox",
      default: true
    }
  ]
};

// src/floorplan/flow/declarations/graph-interpreter.node.json
var graph_interpreter_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-interpreter",
  meta: {
    label: "Graph Interpreter",
    category: "Graph",
    color: "#7c3aed"
  },
  description: "A pure CALCULATION node - the canvas JSON in, matrices out. Reads the payload the Geometry node publishes on `val-canvasJson` and projects it onto the numbers a Math Engine can use: every segment's endpoints, thickness, length and TYPE, every NODE's position and type, the INCIDENCE that joins the two, the PARAMETERS off each element's attached object, and every space's boundary and area. Draws nothing on canvas.",
  instructions: "THE BRIDGE FROM THE PLAN INTO THE MATRIX CHAIN. One node in place of Graph Geometry + Graph to Points, and it reads more than the two of them together could.\n\nWHY IT IS NOT THOSE TWO NODES. That pair routes the plan through GEOMETRY: the Canvas node emits polylines, Graph Geometry rebuilds a graph from them, Graph to Points projects it. Polylines carry coordinates and nothing else, so everything that is not a coordinate is lost on the way \u2014 the segment's type, its opening flag, the objects attached to it. Graph to Points has a `skipOpenings` switch that drops edges typed \"opening\"; fed a graph rebuilt from polylines it finds none, keeps all of them, and reports the whole plan as wall. This node reads the JSON instead, where all of it survives.\n\nINPUT: `json` \u2014 the canvas payload from the Geometry node's `val-canvasJson`. It may arrive through an Input Properties text parameter, which is worth doing: the plan then shows up as a value in the Properties tab, so what the flow is reading is visible rather than implied.\n\nOUTPUTS, all in anchor-relative METRES, one row per segment and row-aligned with each other:\n\u2022 a / b \u2014 edge start and end points (N x 2)\n\u2022 thickness \u2014 the segment's own drawn width (N x 1)\n\u2022 length \u2014 measured from the payload, not recomputed (N x 1)\n\u2022 types \u2014 an integer CODE per segment, 1-based into `typeNames`, 0 for no match\nand per space:\n\u2022 spaces \u2014 the boundaries as ONE flat [x, y, groupIndex] matrix\n\u2022 areas \u2014 one area per space (S x 1)\nplus `segmentCount`, `spaceCount`, `nodeCount`.\n\nThe flat-and-grouped shape for `spaces` is not a style choice. A nested [[[x,y],\u2026],\u2026] list is RAGGED when rooms have different vertex counts, so it fails `isRectMatrix` and reaches the Math Engine as an inert STRING rather than a matrix. Flat with a group column is rectangular whatever the shapes, and the group column splits it back into rooms.\n\nTYPING. `typeNames` is a JSON array, `[\"wall\", \"door\", \"window\"]` by default, and a segment matches a name when its `type` equals it OR any attached object's id begins with it (the library's `door-with-math` / `window-with-math` convention). The LAST match in the list wins, which is what makes an opening read as a door rather than as the wall band it also carries. A segment matching nothing gets code 0.\n\nNODES, INCIDENCE AND PARAMETERS. The payload carries more than geometry and all of it is published:\n\u2022 nodes \u2014 every node's position (N x 2, anchor-relative metres)\n\u2022 nodeTypes \u2014 a code per node from the same `typeNames` table, matched on the attached object's id\n\u2022 segNodes \u2014 each segment's two endpoints as NODE INDICES (M x 2). This is what turns a pile of coordinates into a graph: assembling an incidence matrix in the expression language would otherwise mean clustering endpoints by hand on every evaluation. Exact position matches first, nearest within 2 mm after, and \u22121 when nothing is close \u2014 counted in `unresolvedEnds` rather than guessed, because a wrong incidence silently solves a different network.\n\u2022 nodeVals / segVals \u2014 the PARAMETERS off each element's attached object, one column per key named in `nodeParams` / `segParams`. A pipe's diameter and a junction's demand are already on the canvas; before this they had to be retyped as a matrix beside the drawing that held them.\n\u2022 nodeHas / segHas \u2014 a 1/0 mask of the same shape. A missing parameter reads 0 in the values, never a sentinel, and the mask is what tells \"this pipe's minor loss is zero\" from \"this pipe has no minor loss parameter\". A sentinel inside the values would poison any sum that touched it.\n\nParameters are read as the object's DEFAULTS with the instance's overrides on top, so a key added to a definition after an object was placed still reads.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "json",
        label: "Canvas JSON"
      }
    ],
    valueOutputs: [
      {
        key: "a",
        label: "Edge start points"
      },
      {
        key: "b",
        label: "Edge end points"
      },
      {
        key: "thickness",
        label: "Edge thickness (m)"
      },
      {
        key: "length",
        label: "Edge length (m)"
      },
      {
        key: "types",
        label: "Edge type codes"
      },
      {
        key: "spaces",
        label: "Space boundaries [x, y, group]"
      },
      {
        key: "areas",
        label: "Space areas (m2)"
      },
      {
        key: "nodes",
        label: "Node points"
      },
      {
        key: "nodeTypes",
        label: "Node type codes"
      },
      {
        key: "segNodes",
        label: "Edge node indices [ia, ib]"
      },
      {
        key: "nodeVals",
        label: "Node object params"
      },
      {
        key: "nodeHas",
        label: "Node params present (1/0)"
      },
      {
        key: "segVals",
        label: "Edge object params"
      },
      {
        key: "segHas",
        label: "Edge params present (1/0)"
      },
      {
        key: "unresolvedEnds",
        label: "Unresolved endpoints"
      },
      {
        key: "segmentCount",
        label: "Segments"
      },
      {
        key: "spaceCount",
        label: "Spaces"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      }
    ]
  },
  parameters: [
    {
      key: "json",
      kind: "text",
      label: "Canvas JSON",
      default: "",
      help: "The payload from the Geometry node's Canvas JSON output. Usually wired rather than pasted."
    },
    {
      key: "typeNames",
      kind: "text",
      label: "Type names (JSON array)",
      default: '["wall", "door", "window"]',
      help: "Names for the `types` code column, 1-based. A segment matches on its own type or on an attached object id that begins with the name; the LAST match wins, so an opening reads as door/window rather than as the wall band it also carries."
    },
    {
      key: "nodeParams",
      kind: "text",
      label: "Node parameter keys",
      default: "",
      help: "Parameter keys to read off each NODE's attached object, as `a, b, c` or a JSON array. Publishes `nodeVals` (one row per node, one column per key, row-aligned with `nodes`) and `nodeHas`, the 1/0 mask saying which were actually present."
    },
    {
      key: "segParams",
      kind: "text",
      label: "Segment parameter keys",
      default: "",
      help: "The same for each SEGMENT's attached object. Publishes `segVals` and `segHas`, row-aligned with `a` / `b`."
    }
  ]
};

// src/floorplan/flow/declarations/canvas-encoder.node.json
var canvas_encoder_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "canvas-encoder",
  meta: {
    label: "Canvas Encoder",
    category: "Graph",
    color: "#be123c"
  },
  description: "A pure CALCULATION node \u2014 matrices in, a whole PLAN DOCUMENT out. The inverse of Graph Interpreter: takes a typed edge list from a Math Engine and writes the standard plan JSON, objects and their parameters attached, ready to import. Draws nothing on canvas.",
  instructions: "THE WRITE HALF OF THE CODEC. Graph Interpreter reads the canvas into matrices; this writes matrices back out as a plan. Between them a flow can read a drawing, compute over it and emit a new one without ever materialising anything.\n\nIt is NOT Points to Graph. That node emits a GRAPH \u2014 nodes, edges, thickness, type \u2014 which still needs a Network node to become canvas segments, and a graph has nowhere to carry an attachment. This emits the full document: `schemaVersion`, `settings`, `nodes`, `segments`, `spaces`, `layers`, with each segment carrying its parametric object, that object's PARAMS and its library PATH. The result is the same shape the canvas exports, so it imports straight back.\n\nINPUTS \u2014 one row per edge, all row-aligned, all in anchor-relative METRES (the frame every value output speaks):\n\u2022 a / b \u2014 edge start and end points (N x 2)\n\u2022 thickness \u2014 per edge (N x 1); falls back to the type's own thickness where 0\n\u2022 types \u2014 an integer CODE per edge, 1-based into `typeNames`\n\u2022 spaces \u2014 OPTIONAL space boundaries as one flat [x, y, groupIndex] matrix. Leave it unwired and the canvas derives rooms from the wall loops on import, which is usually what you want: a space references NODE IDS, so its corners have to coincide with real segment endpoints to be worth writing.\n\nNODES ARE DEDUPLICATED BY POSITION, so a junction where four walls meet becomes ONE node with four segments on it rather than eight loose endpoints \u2014 the same rule the canvas's own exporter follows. Points are compared after rounding to `decimals`, because two endpoints a ten-thousandth of a millimetre apart are the same junction and would otherwise write two nodes that never join.\n\n`typeMap` is where the parametric objects live: a JSON object keyed by type name, each entry naming the `segmentType` the canvas should use, the `layer`, and the object to attach \u2014 `objectId`, `objectPath` (the library link) and `params`. Anything omitted is simply left off that segment. An `opening: true` entry marks the segment as a door/window gap.\n\nCOORDINATES GO OUT IN PIXELS, metres x `pixelsPerMeter`, because that is what a plan document stores; `settings.pixelsPerMeter` is written alongside so the reader can convert back.\n\nNODE-HOSTED OBJECTS \u2014 furniture and anything else that sits at a POINT rather than along a segment. Wire `points` (N x 2 metres), `pointTypes` (the code column) and optionally `pointRotation`, and name the objects in `pointTypeMap`. Each point becomes a node carrying its object.\n\nEach one also gets a DEGENERATE MARKER SEGMENT, from that node back to itself, and it is not decoration: the plan reader rebuilds node metadata under a key derived from the segment ends meeting at the node, so a node no segment touches has no key and its attachments are silently DROPPED on import. The marker is what gives the node a key. It is the same thing the canvas's own exporter writes for a node-hosted object.\n\nONE MAP, NOT FIVE. `objects` holds `segments`, `points` and `space`. A code column indexes its map by KEY ORDER \u2014 JSON preserves insertion order, so the map's own ordering is the code table and no parallel array of names is needed. Params are OVERRIDES only: the editor fills every parameter from the object's own defaults before applying an attachment's, so an entry needs to name only what differs.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "a",
        label: "Edge start points"
      },
      {
        key: "b",
        label: "Edge end points"
      },
      {
        key: "thickness",
        label: "Edge thickness (m)"
      },
      {
        key: "types",
        label: "Edge type codes"
      },
      {
        key: "spaces",
        label: "Space boundaries [x, y, group]"
      },
      {
        key: "points",
        label: "Object points"
      },
      {
        key: "pointTypes",
        label: "Object type codes"
      },
      {
        key: "pointRotation",
        label: "Object rotation (deg)"
      }
    ],
    valueOutputs: [
      {
        key: "json",
        label: "Plan (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "segmentCount",
        label: "Segments"
      },
      {
        key: "spaceCount",
        label: "Spaces"
      },
      {
        key: "pointCount",
        label: "Node objects"
      },
      {
        key: "objectCount",
        label: "Objects attached"
      },
      {
        key: "bytes",
        label: "JSON size",
        unit: "B"
      }
    ]
  },
  parameters: [
    {
      key: "objects",
      kind: "text",
      label: "Objects (JSON)",
      default: '{\n  "segments": {},\n  "points": {},\n  "space": {}\n}',
      help: "Everything the plan attaches, in one map. `segments` keyed by edge-type name in CODE ORDER, `points` keyed by object-type name in code order, `space` the object every space carries. Each entry names its objectId, its objectPath and any params that differ from the object's own defaults."
    },
    {
      key: "pixelsPerMeter",
      kind: "number",
      label: "Pixels per metre",
      default: 50,
      min: 1,
      max: 1e3,
      step: 1
    },
    {
      key: "libraryPath",
      kind: "text",
      label: "Library path",
      default: "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library"
    },
    {
      key: "decimals",
      kind: "number",
      label: "Coordinate decimals",
      default: 4,
      min: 0,
      max: 6,
      step: 1
    }
  ]
};

// src/floorplan/flow/declarations/matrix-reduce.node.json
var matrix_reduce_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-reduce",
  meta: { label: "Reduce", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 fold a matrix down to fewer numbers: Sum, Min, Max, Mean or Product, over the whole matrix, per row, or per column. Draws nothing.",
  instructions: 'A value-only node: a matrix in, a smaller matrix out. It has no geometry input or output and draws nothing on the canvas.\n\nWHY IT EXISTS: every other matrix node is shape-preserving or shape-combining \u2014 none of them can answer "what is the total / the smallest / the average". Reduce is the aggregate step, and its 1\xD71 result BROADCASTS back over any shape through Matrix Operations, so a whole-matrix statistic can be applied per row.\n\nAXIS:\n\u2022 All \u2192 one number (1\xD71). Total area, first event time, global min.\n\u2022 Per row \u2192 N\xD71, folding each row across its columns.\n\u2022 Per column \u2192 1\xD7C, folding each column down its rows. Column sums of an N\xD72 point list give (\u03A3x, \u03A3y) \u2014 divide by N for the centroid.\n\nTWO IDIOMS worth knowing:\n\u2022 SIGNED AREA / WINDING \u2014 Vector Product (Cross) of a point list against Shift Rows(-1) gives the per-edge shoelace terms; Reduce (Sum, All) totals them. The result is 2\xD7area, and its SIGN is the polygon\'s winding (positive = counter-clockwise). Divide it by its own absolute value to get \xB11, then multiply your normals by that to make them face inward whatever the winding.\n\u2022 SMALLEST POSITIVE \u2014 Reduce (Min) counts negatives and zeros too. To get the smallest POSITIVE entry, take 1/x first (Matrix Operations Divide, with A = [[1]]), Reduce (Max), then invert again: non-positive entries become \u2264 0 and lose automatically.\n\nOUTPUT: `val-matrix` plus `val-rows` / `val-cols`. Every parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "a", label: "Matrix" },
      { key: "op", label: "Operation" },
      { key: "axis", label: "Axis" }
    ],
    valueOutputs: [
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "rows", label: "Rows" },
      { key: "cols", label: "Cols" },
      { key: "value", label: "Value" }
    ]
  },
  parameters: [
    {
      key: "op",
      label: "Operation",
      kind: "select",
      default: "sum",
      options: [
        { value: "sum", label: "Sum" },
        { value: "min", label: "Min" },
        { value: "max", label: "Max" },
        { value: "mean", label: "Mean" },
        { value: "product", label: "Product" }
      ]
    },
    {
      key: "axis",
      label: "Axis",
      kind: "select",
      default: "all",
      options: [
        { value: "all", label: "All (\u2192 1\xD71)" },
        { value: "rows", label: "Per row (\u2192 N\xD71)" },
        { value: "cols", label: "Per column (\u2192 1\xD7C)" }
      ]
    },
    { key: "a", label: "Matrix (JSON)", kind: "text", default: "" }
  ]
};

// src/floorplan/flow/declarations/matrix-eigen.node.json
var matrix_eigen_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "matrix-eigen",
  meta: { label: "Eigen", category: "Grid", color: "#0e7490" },
  description: "A pure CALCULATION node \u2014 ALL eigenvalues and eigenvectors of a SYMMETRIC matrix by cyclic Jacobi rotation. Matrix in, values + vectors out; draws nothing.",
  instructions: "A value-only node: a symmetric matrix as JSON in, its complete eigen-decomposition out. It has no geometry input or output and draws nothing on the canvas.\n\nWHY IT IS A NODE AND NOT A FLOW. Jacobi repeats until the off-diagonal mass drops below tolerance \u2014 a data-dependent stopping test. The flow evaluator is a DAG (topological sort, cycles rejected), so no arrangement of nodes can express that loop; the Loop node is a geometry array and does not iterate values. Unrolling power-iteration blocks in the graph works but only ever yields the DOMINANT pair, and converges at |\u03BB\u2082/\u03BB\u2081| per block. This runs the loop internally, converges in 2\u20134 sweeps, and returns every pair.\n\nINPUT: wire a square symmetric matrix into valin-matrix \u2014 an inertia tensor, a covariance matrix, a stiffness matrix, or a graph Laplacian. The matrix is symmetrised on entry ((A + A\u1D40)/2), so float noise or a slightly-off typed tensor is well-posed rather than silently wrong. NON-SYMMETRIC input is therefore treated as its symmetric part \u2014 this node does not do general (complex) eigenvalues.\n\nOUTPUTS:\n\u2022 `val-values` \u2014 the eigenvalues as an n\xD71 column, sorted (default largest first).\n\u2022 `val-vectors` \u2014 an n\xD7n matrix whose COLUMNS are the matching unit eigenvectors, in the same order. They are orthonormal, so the transpose is also the inverse.\n\u2022 `val-dominant` \u2014 the leading eigenvector alone, as an n\xD71 column, ready to wire onward.\n\u2022 `val-angle` \u2014 the direction of the leading eigenvector in the XY plane, in DEGREES. For a 2\xD72 tensor this is the principal-axis angle directly.\n\nWHAT THE NUMBERS MEAN depends on the matrix you feed it. Inertia tensor [[Ixx, \u2212Ixy], [\u2212Ixy, Iyy]] \u2192 I_max / I_min and the principal-axis angle, which is what governs bending of any unsymmetric section (angles, channels, Z-purlins). Covariance of a point set \u2192 PCA: the leading eigenvector is the shape's dominant orientation. Stiffness with mass \u2192 mode shapes. Graph Laplacian \u2192 the second-smallest eigenvalue's vector is the Fiedler vector, which partitions the graph.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "matrix", label: "Matrix" },
      { key: "sort", label: "Sort" }
    ],
    valueOutputs: [
      { key: "values", label: "Eigenvalues" },
      { key: "vectors", label: "Eigenvectors" },
      { key: "dominant", label: "Dominant vector" },
      { key: "angle", label: "Principal angle", unit: "\xB0" }
    ]
  },
  parameters: [
    {
      key: "sort",
      label: "Sort",
      kind: "select",
      default: "desc",
      options: [
        { value: "desc", label: "Largest first" },
        { value: "asc", label: "Smallest first" },
        { value: "none", label: "Unsorted" }
      ]
    },
    { key: "matrix", label: "Matrix (JSON)", kind: "text", default: "" },
    { key: "sweeps", label: "Max sweeps", kind: "number", default: 50, step: 1 }
  ]
};

// src/floorplan/flow/declarations/snapshot.node.json
var snapshot_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "snapshot",
  meta: {
    label: "Snapshot",
    category: "Output",
    color: "#7c3aed"
  },
  description: "A LIVE photograph of the plan AND of the 3D model from above, shown inside the node \u2014 no button to press. Frame the WHOLE drawing, or wire geometry in and frame just that. Both images are PNG data URLs on their own output endpoints.",
  instructions: "A live capture node. It draws nothing on the canvas; its geometry input is a FRAMING hint, not something it renders.\n\nIt photographs the current canvas \u2014 the SAME snapshot the Agent node takes for its vision-critique loop \u2014 and RE-photographs it by itself whenever the picture changes: an edit to the flow, a wall drawn on the plan, a node's eye toggled. There is nothing to press; the images inside the node are always the current ones. That is the quickest way to see whether the snapshot pipeline is working, and it keeps working while you edit.\n\nSCOPE\n\u2022 WHOLE (default) \u2014 frames every visible thing on the canvas, the zoom-to-extent the Agent's critique sees. Needs no input.\n\u2022 SELECTED \u2014 frames ONLY the geometry wired into this node's input, plus the Margin below. Wire any geometry node in (Space, Rectangle, Inset, a Render row \u2026) and the shot closes in on it; the rest of the plan simply falls outside the frame. With nothing wired in there is nothing to frame, so it falls back to Whole rather than photographing an empty box.\n\nSELECTED can also be told its region as a LIST: `valin-points` takes `[[x,y],\u2026]` in metres \u2014 a Geometry node's `val-points`, or an Input Properties parameter holding it \u2014 and frames that. The geometry input still works and still WINS when both are connected. A flow that already passes its outline around as a value therefore needs no second geometry wire beside it.\n\nMARGIN is breathing room around the framed geometry, in metres. It applies to both images, so the plan and the 3D view close in together.\n\nWHAT COUNTS AS A CHANGE: the flow's live preview geometry, the committed canvas (spaces / nodes / segments / graphs / images / freehand strokes), the 3D solids being drawn, which nodes are hidden, and this node's own Scope / Margin. Re-capture is debounced, so dragging a slider photographs the result you stop on, not every frame in between \u2014 expect the images to land a moment after the canvas settles. An empty frame clears the images rather than leaving the last good one standing, because a stale picture that looks fine is exactly the failure this node exists to catch. Orbiting the 3D camera is NOT a change it can see: the 3D shot is taken from a fixed camera fitted to the scope, not from your current view.\n\nOUTPUTS \u2014 two PNG data URL strings, ready to wire into any node that accepts an image value input (Analyse's File input, the Render node's Image input):\n\u2022 `val-image` \u2014 the PLAN (top = NORTH).\n\u2022 `val-image-3d` \u2014 the 3D VIEW, looking straight DOWN and fitted to the same scope, so it registers with the plan beside it. EMPTY unless the 3D view is already open: a node that fires on its own must not switch the app out of the plan to answer, so open 3D (or the split view) if you want this endpoint live.\n\nBoth images are transient \u2014 they are not saved with the flow, and re-form on their own when it is reopened.",
  handles: {
    input: true,
    output: false,
    valueInputs: [
      {
        key: "points",
        label: "Region (points)"
      },
      {
        key: "margin",
        label: "Margin"
      }
    ],
    valueOutputs: [
      {
        key: "image",
        label: "Plan Image"
      },
      {
        key: "image-3d",
        label: "3D Image"
      }
    ]
  },
  parameters: [
    {
      key: "scope",
      label: "Scope",
      kind: "select",
      default: "whole",
      options: [
        {
          value: "whole",
          label: "Whole canvas"
        },
        {
          value: "selected",
          label: "Selected (wired-in geometry)"
        }
      ]
    },
    {
      key: "margin",
      label: "Margin",
      kind: "range",
      default: 1,
      min: 0,
      max: 20,
      step: 0.1,
      unit: "m",
      showWhen: "scope == 'selected'"
    }
  ]
};

// src/floorplan/flow/declarations/set-thickness.node.json
var set_thickness_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "set-thickness",
  meta: {
    label: "Set Thickness",
    category: "Graph",
    color: "#0d9488"
  },
  description: "A pure CALCULATION node \u2014 set a uniform wall thickness (and optionally an edge type) on every edge of a graph: graph in, graph out. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a GRAPH as JSON and returns a graph as JSON with `thickness` (metres) set on EVERY edge to the parameter value. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire BSP / Graph Reduce val-graph into valin-graph.\n\nOUTPUT: val-graph publishes the SAME graph (node ids + coordinates untouched) with every edge\'s `thickness` overwritten by the Thickness param. Wire it into another graph node, or into Merge Graph to combine graphs that carry different thicknesses.\n\nEDGE TYPE: the optional Edge type param additionally stamps `type` on every edge \u2014 "wall", "door", "window" or "opening". Leave it on "(leave unchanged)" to keep whatever type the incoming edges already carry. This is what lets ONE merged graph distinguish its families: tag an exterior-wall graph at 0.23 m / "wall", an interior-wall graph at 0.1 m / "wall", a door graph at 0.1 m / "door" and a window graph at 0.23 m / "window", then Merge Graph unions all four with each edge keeping its own width and type. Note that Mitered Join and Graph to Matrix both SKIP `type: "opening"` edges, so use "door" / "window" (not "opening") when the openings should still be stroked.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "thickness",
        label: "Thickness"
      },
      {
        key: "type",
        label: "Edge type"
      }
    ],
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "thickness",
      label: "Thickness",
      kind: "range",
      default: 0.1,
      min: 0.02,
      max: 1,
      step: 0.01,
      unit: "m"
    },
    {
      key: "type",
      label: "Edge type",
      kind: "select",
      default: "",
      options: [
        {
          value: "",
          label: "(leave unchanged)"
        },
        {
          value: "wall",
          label: "Wall"
        },
        {
          value: "door",
          label: "Door"
        },
        {
          value: "window",
          label: "Window"
        },
        {
          value: "room",
          label: "Room"
        },
        {
          value: "furniture",
          label: "Furniture"
        },
        {
          value: "opening",
          label: "Opening (skipped by Mitered Join)"
        }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/merge-graph.node.json
var merge_graph_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "merge-graph",
  meta: {
    label: "Merge Graph",
    category: "Graph",
    color: "#0f766e"
  },
  description: "A pure CALCULATION node \u2014 merge several graphs into one: graphs in, one graph out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes SEVERAL GRAPHS and returns their union as one graph JSON. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: wire more than one val-graph into the single valin-graph handle (fan-in) \u2014 every source's graph is merged. Nodes at the same position (in the shared anchor frame) collapse to one, so graphs that meet at a junction stay connected; overlapping edges are de-duplicated. Each edge keeps ITS OWN `thickness`, so a 0.2 m outer-wall graph and a 0.1 m inner-wall graph merge into one graph with both thicknesses preserved.\n\nOUTPUT: val-graph publishes the merged graph \u2014 wire it into a Network node to draw it, or into another graph node to process it further.",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graphs"
      }
    ],
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    }
  ]
};

// src/floorplan/flow/declarations/graph-to-openings.node.json
var graph_to_openings_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "graph-to-openings",
  meta: {
    label: "Graph to Openings",
    category: "Graph",
    color: "#7c3aed"
  },
  description: "A pure CALCULATION node \u2014 carve door/window openings into a partition graph: graph in, graph out. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a partition GRAPH and returns a graph whose edges carry `type` ("wall" | "opening"). It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id", "thickness" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire a Merge Graph (or BSP) val-graph into valin-graph.\n\nWHAT IT DOES: it traces the planar faces of the graph \u2014 the largest face per component is the OUTER boundary, every other face is a ROOM. It then centres one OUTER opening (window, `Outer opening width`) on EACH boundary edge, and one INNER opening (door, `Inner opening width`) on the LONGEST interior wall of EACH room (deduped so a shared wall opens once). A carved edge A\u2192B becomes A\u2192P1 (wall) \xB7 P1\u2192P2 (opening) \xB7 P2\u2192B (wall); the jamb nodes are added and the wall parts keep the edge\'s thickness. Walls shorter than the opening plus a jamb each side stay solid.\n\nOUTPUT: val-graph publishes the graph with every edge tagged `type` "wall" or "opening". Wire it into Mitered Join \u2014 with "Use same width for all" OFF it strokes the walls (at their own thickness) and SKIPS the openings, leaving real gaps.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "outerWidth",
        label: "Outer opening"
      },
      {
        key: "innerWidth",
        label: "Inner opening"
      }
    ],
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      },
      {
        key: "openings",
        label: "Openings"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "outerWidth",
      label: "Outer opening width",
      kind: "range",
      default: 1,
      min: 0,
      max: 5,
      step: 0.05,
      unit: "m"
    },
    {
      key: "innerWidth",
      label: "Inner opening width",
      kind: "range",
      default: 0.9,
      min: 0,
      max: 5,
      step: 0.05,
      unit: "m"
    }
  ]
};

// src/floorplan/flow/declarations/label-graph.node.json
var label_graph_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "label-graph",
  meta: {
    label: "Label Graph",
    category: "Graph",
    color: "#0d9488"
  },
  description: "A pure CALCULATION node \u2014 name each connected component of a graph from a labels array, and optionally stamp an edge type and thickness at the same time. Graph in, graph out; draws nothing on canvas.",
  instructions: 'A value-only node: it takes a GRAPH as JSON plus a LABELS array, and returns the same graph with `label` stamped on every edge \u2014 the name of the component that edge belongs to. It has no geometry input or output and draws nothing.\n\nWHY IT EXISTS: Set Thickness gives a whole graph ONE type and width, which answers "what kind of thing is this". It cannot answer "which one is it". Object Detection publishes `val-graph` (one closed ring per detected object, in detection order) alongside `val-labels` (the names, same order) \u2014 wire both in here and component i takes label i, so a graph of six rectangles becomes "Bedroom", "Bathroom", "sofa", \u2026 Together with `type` and `thickness` this turns a raw detection into a fully tagged family in one node.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Object Detection val-graph, or any other graph node\'s val-graph, into valin-graph.\n\nLABELS accepts a JSON array of strings ("[\\"Bedroom\\",\\"Kitchen\\"]") or a bare comma-separated list typed into the field. Components are numbered by the order their first node appears, which is the order the boxes were serialised \u2014 that is what keeps label i on box i. A SINGLE label names EVERY component, which is what you want when the whole graph is one family (all walls). A component past the end of the array keeps whatever label it already had.\n\nEDGE TYPE stamps `type` on every edge \u2014 "wall", "door", "window", "room", "furniture" or "opening". THICKNESS overwrites `thickness` in metres; leave it at 0 to keep whatever the incoming edges already carry (a detection graph has none, a wall graph usually does).\n\nOUTPUT: val-graph publishes the tagged graph \u2014 wire it into Merge Graph to union it with the other families, each keeping its own type, width and label. `val-labelled` reports how many edges actually received a name, which is how you catch a labels array that was shorter than the component count.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "graph", label: "Graph" },
      { key: "labels", label: "Labels" },
      { key: "type", label: "Edge type" },
      { key: "thickness", label: "Thickness" }
    ],
    valueOutputs: [
      { key: "graph", label: "Graph (JSON)" },
      { key: "nodeCount", label: "Nodes" },
      { key: "edgeCount", label: "Edges" },
      { key: "labelled", label: "Labelled edges" }
    ]
  },
  parameters: [
    { key: "graph", label: "Graph (JSON)", kind: "text", default: "" },
    { key: "labels", label: "Labels (JSON array)", kind: "text", default: "", placeholder: '["Bedroom", "Kitchen"]' },
    {
      key: "type",
      label: "Edge type",
      kind: "select",
      default: "",
      options: [
        { value: "", label: "(leave unchanged)" },
        { value: "wall", label: "Wall" },
        { value: "door", label: "Door" },
        { value: "window", label: "Window" },
        { value: "room", label: "Room" },
        { value: "furniture", label: "Furniture" },
        { value: "opening", label: "Opening (skipped by Mitered Join)" }
      ]
    },
    { key: "thickness", label: "Thickness", kind: "range", default: 0, min: 0, max: 1, step: 0.01, unit: "m" }
  ]
};

// src/floorplan/flow/declarations/filter-by-label.node.json
var filter_by_label_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "filter-by-label",
  meta: {
    label: "Filter by Label",
    category: "Image",
    color: "#a21caf"
  },
  description: "A pure CALCULATION node \u2014 keep only the detections whose label matches. Splits ONE Object Detection result into families (doors / windows / rooms) so a single API call replaces one call per class. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a labelled detection and returns the subset whose label matches, on the SAME endpoint names Object Detection publishes \u2014 so it drops straight into wiring that already expects a detection.\n\nWHY IT EXISTS: asking Gemini for "door, window, room" in ONE call costs a fraction of three separate calls, but every box then arrives on one pair of endpoints. Wire that one detection into three of these \u2014 match "door", "window", "room" \u2014 and you get the three families back, each ready for Label Graph and Merge Graph.\n\nINPUT: wire Object Detection\'s val-polygons into valin-polygons AND its val-labels into valin-labels. Filtering is by INDEX \u2014 label i belongs to ring i \u2014 so BOTH must come from the same detection node, and the labels endpoint is not optional. You may wire val-graph into valin-graph instead of polygons; components are then filtered by the same index rule. Polygons win when both are supplied, because a ring list carries the boundary vertices exactly.\n\nMATCH is a comma-separated list of terms: "door" keeps every label containing "door" (so "door", "Door", "sliding door" and "doorway" all match), and "door, gate" keeps either. Matching is case-insensitive and matches in BOTH directions, so the term "door" also keeps a label of "dr" only if one contains the other \u2014 set Match mode to "Exact" when you need the label to equal the term. Invert keeps everything that does NOT match, which is how you collect the leftovers into a "furniture" catch-all after the named families have been taken. An EMPTY match passes everything through unchanged (inverted: nothing), so an unconfigured node is visibly inert rather than silently emptying the branch.\n\nOUTPUT: val-polygons (the kept rings as a nested [[[x,y],\u2026],\u2026] metre list), val-graph (the kept rings as node/edge JSON, one closed component per ring, each edge already carrying its `label`), val-labels (the kept names, same order), val-count and val-area (m\xB2). Chain val-graph + val-labels into Label Graph to stamp the family\'s type and thickness, then Merge Graph.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      { key: "polygons", label: "Polygons" },
      { key: "labels", label: "Labels" },
      { key: "graph", label: "Graph" },
      { key: "match", label: "Match" }
    ],
    valueOutputs: [
      { key: "polygons", label: "Polygons (JSON)" },
      { key: "graph", label: "Graph (JSON)" },
      { key: "labels", label: "Labels (JSON)" },
      { key: "count", label: "Kept" },
      { key: "area", label: "Total area", unit: "m\xB2" }
    ]
  },
  parameters: [
    { key: "polygons", label: "Polygons (JSON)", kind: "text", default: "" },
    { key: "labels", label: "Labels (JSON array)", kind: "text", default: "", placeholder: '["door", "window"]' },
    { key: "graph", label: "Graph (JSON)", kind: "text", default: "" },
    { key: "match", label: "Match", kind: "text", default: "", placeholder: "door, doorway" },
    {
      key: "mode",
      label: "Match mode",
      kind: "select",
      default: "contains",
      options: [
        { value: "contains", label: "Contains (loose)" },
        { value: "exact", label: "Exact" }
      ]
    },
    { key: "invert", label: "Invert (keep non-matching)", kind: "checkbox", default: false }
  ]
};

// src/floorplan/flow/declarations/voronoi-bloom.node.json
var voronoi_bloom_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "voronoi-bloom",
  meta: {
    label: "Voronoi Bloom",
    category: "Graph",
    color: "#1d4ed8"
  },
  description: "A pure CALCULATION node \u2014 grow Voronoi cells from graph nodes: graph in, coordinates out. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a GRAPH as JSON and returns polygons as a coordinate list. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Graph Geometry val-graph, or Skeleton val-branches, into valin-graph.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "radius",
        label: "Radius"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "mode",
      label: "Bloom from",
      kind: "select",
      default: "vertices",
      options: [
        {
          value: "vertices",
          label: "Voronoi Vertices"
        },
        {
          value: "edges",
          label: "Voronoi Edges"
        }
      ]
    },
    {
      key: "intersect",
      label: "Intersect to spaces",
      kind: "checkbox",
      default: true,
      showWhen: "mode == 'edges'"
    },
    {
      key: "radius",
      label: "Radius",
      kind: "range",
      default: 1,
      min: 0,
      max: 30,
      step: 0.05,
      unit: "m"
    },
    {
      key: "sides",
      label: "Circle sides",
      kind: "range",
      default: 24,
      min: 3,
      max: 64,
      step: 1
    }
  ]
};

// src/floorplan/flow/declarations/spring-layout.node.json
var spring_layout_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "spring-layout",
  meta: {
    label: "Spring Layout",
    category: "Graph",
    color: "#6366f1"
  },
  description: "A pure CALCULATION node \u2014 force-directed layout of a graph: graph in, graph out. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a GRAPH as JSON and returns a graph as JSON. It has no geometry input or output and draws nothing on the canvas.\n\nINPUT: graph takes { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id" }, ...] } \u2014 coordinates in metres, local to the anchor. Wire Graph Geometry val-graph, or Skeleton val-branches, into valin-graph.\n\nOUTPUT: val-graph publishes the result in the same shape \u2014 wire it into a Network node to draw it, or into another graph value node to chain.\n\nEvery parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "graph",
        label: "Graph"
      },
      {
        key: "iterations",
        label: "Iterations"
      },
      {
        key: "edgeLength",
        label: "Edge length"
      },
      {
        key: "repulsion",
        label: "Repulsion"
      }
    ],
    valueOutputs: [
      {
        key: "graph",
        label: "Graph (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "graph",
      label: "Graph (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "iterations",
      label: "Iterations",
      kind: "range",
      default: 100,
      min: 1,
      max: 500,
      step: 1
    },
    {
      key: "edgeLength",
      label: "Edge length",
      kind: "range",
      default: 5,
      min: 0.2,
      max: 50,
      step: 0.2,
      unit: "m"
    },
    {
      key: "repulsion",
      label: "Repulsion",
      kind: "range",
      default: 1,
      min: 0,
      max: 5,
      step: 0.05
    },
    {
      key: "step",
      label: "Energy",
      kind: "range",
      default: 1,
      min: 0.1,
      max: 3,
      step: 0.1
    }
  ]
};

// src/floorplan/flow/declarations/pipe-solver.node.json
var pipe_solver_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "pipe-solver",
  meta: { label: "Pipe Network Solver", category: "Graph", color: "#0e7490" },
  description: "Solve a pipe network (Todini global gradient). Wire a Graph node into the main input (unconnected = whole canvas graph) and a Schema node into the Schema input to define node/segment properties; edit them per component in the Properties tab; per-component results appear in the Metrics tab.",
  instructions: "Solves a pipe network with the Todini global-gradient method. Wire a Graph node into the MAIN input (unconnected \u2192 the whole canvas segment graph). Wire a Schema node into the `gin-schema` input: its Node/Segment sections define the per-component input properties (demand, elevation, diameter\u2026) by role, shown in each component's Properties tab; results (discharge, head, velocity, pressure\u2026) land in each component's Metrics tab.\n\n`formula` = Hazen-Williams or Darcy-Weisbach; `maxIter` / `tolerance` bound the solve. Publishes `val-totalDemand` / `val-maxVelocity` / `val-minPressure` / `val-iterations`.",
  handles: {
    input: true,
    output: true,
    geomInputs: [
      { key: "schema", label: "Schema" }
    ],
    valueOutputs: [
      { key: "totalDemand", label: "Total demand (L/s)" },
      { key: "maxVelocity", label: "Max velocity (m/s)" },
      { key: "minPressure", label: "Min pressure (m)" },
      { key: "iterations", label: "Iterations" }
    ]
  },
  parameters: [
    {
      key: "formula",
      label: "Formula",
      kind: "select",
      default: "hazen-williams",
      options: [
        { value: "hazen-williams", label: "Hazen-Williams" },
        { value: "darcy-weisbach", label: "Darcy-Weisbach" }
      ]
    },
    { key: "maxIter", label: "Max iterations", kind: "range", default: 60, min: 5, max: 200, step: 1 },
    { key: "tolerance", label: "Tolerance", kind: "range", default: 1e-3, min: 1e-4, max: 0.05, step: 1e-4 }
  ]
};

// src/floorplan/flow/declarations/split.node.json
var split_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "split",
  meta: {
    label: "Split",
    category: "Partition",
    color: "#0d9488"
  },
  description: "Split a polygon into pieces \u2014 a pure CALCULATION node: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns its pieces as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want the pieces drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon.\n\nOUTPUT: val-polygons publishes every piece as a nested [[[x,y],...],...] list, which a Polygon node accepts directly. NOTE: this is the WHOLE set \u2014 there are no per-piece handles any more, so a single piece can no longer be selected downstream.\n\nSPLIT: type / count / mode / target / ratios / angle / principalMethod shape the cut. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "type",
        label: "Type"
      },
      {
        key: "count",
        label: "Pieces"
      },
      {
        key: "principalMethod",
        label: "Method"
      },
      {
        key: "mode",
        label: "Sizing"
      },
      {
        key: "target",
        label: "First piece area"
      },
      {
        key: "ratios",
        label: "Ratios"
      },
      {
        key: "splitAlongMinorPrincipalAxis",
        label: "Along minor axis"
      },
      {
        key: "angle",
        label: "Angle"
      },
      {
        key: "stripLength",
        label: "Strip length"
      },
      {
        key: "stripPosition",
        label: "Strip position"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "type",
      label: "Type",
      kind: "select",
      default: "normal",
      options: [
        {
          value: "normal",
          label: "Normal"
        },
        {
          value: "strip",
          label: "Strip"
        },
        {
          value: "principal",
          label: "Principal Axes"
        }
      ]
    },
    {
      key: "count",
      label: "Pieces",
      kind: "range",
      default: 2,
      min: 2,
      max: 12,
      step: 1,
      showWhen: "(type == 'normal' && mode != 'ratio') || type == 'principal'"
    },
    {
      key: "principalMethod",
      label: "Method",
      kind: "select",
      default: "pca",
      options: [
        {
          value: "pca",
          label: "PCA (moments)"
        },
        {
          value: "obb",
          label: "Min-area OBB"
        },
        {
          value: "skeleton",
          label: "Straight Skeleton"
        }
      ],
      showWhen: "type == 'principal'"
    },
    {
      key: "mode",
      label: "Sizing",
      kind: "select",
      default: "equal",
      options: [
        {
          value: "equal",
          label: "Equal (area)"
        },
        {
          value: "target",
          label: "Target area"
        },
        {
          value: "ratio",
          label: "Ratio"
        }
      ],
      showWhen: "type == 'normal'"
    },
    {
      key: "target",
      label: "First piece area",
      kind: "range",
      default: 20,
      min: 1,
      max: 200,
      step: 1,
      unit: "m\xB2",
      showWhen: "type == 'normal' && mode == 'target'"
    },
    {
      key: "ratios",
      label: "Ratios",
      kind: "text",
      default: "1, 2, 1",
      placeholder: "1, 2, 1",
      showWhen: "type == 'normal' && mode == 'ratio'"
    },
    {
      key: "splitAlongMinorPrincipalAxis",
      label: "Along minor axis",
      kind: "checkbox",
      default: false,
      showWhen: "type == 'normal'"
    },
    {
      key: "angle",
      label: "Angle",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0",
      showWhen: "type != 'principal' && !splitAlongMinorPrincipalAxis"
    },
    {
      key: "stripLength",
      label: "Strip length",
      kind: "range",
      default: 1,
      min: 0.1,
      max: 20,
      step: 0.05,
      unit: "m",
      showWhen: "type == 'strip'"
    },
    {
      key: "stripPosition",
      label: "Strip position",
      kind: "range",
      default: 50,
      min: 0,
      max: 100,
      step: 1,
      unit: "%",
      showWhen: "type == 'strip'"
    }
  ]
};

// src/floorplan/flow/declarations/skeleton.node.json
var skeleton_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "skeleton",
  meta: {
    label: "Skeleton",
    category: "Partition",
    color: "#0891b2"
  },
  description: "A pure CALCULATION node \u2014 compute the medial axis (raw skeletonization only): polygon in, skeleton out. Draws nothing on canvas.",
  instructions: "A value-only node that does SKELETONIZATION ONLY \u2014 the raw medial-axis branches. Post-processing (prune spurs, longest branch, join to boundary) now lives in the Graph Reduce node: wire val-branches into a Graph Reduce.\n\nINPUT: `vertices` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-vertices. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-branches publishes the medial axis as a node/edge GRAPH JSON (wire into Graph Reduce / Mitered Join); val-polygons publishes the same axis as a nested list of line segments (a Polyline / Network node can draw it).\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "vertices",
        label: "Vertices"
      },
      {
        key: "type",
        label: "Type"
      },
      {
        key: "samples",
        label: "Samples"
      },
      {
        key: "level",
        label: "Level"
      },
      {
        key: "reduceLevel",
        label: "Reduce segments"
      }
    ],
    valueOutputs: [
      {
        key: "branches",
        label: "Branches (graph JSON)"
      },
      {
        key: "polygons",
        label: "Polygons (JSON)"
      },
      {
        key: "polygonCount",
        label: "Polygons"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  parameters: [
    {
      key: "vertices",
      label: "Vertices (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "type",
      label: "Type",
      kind: "select",
      default: "straight-skeleton",
      options: [
        {
          value: "sampled-voronoi",
          label: "Sampled Voronoi"
        },
        {
          value: "segment-sweepline",
          label: "Sweepline (segments)"
        },
        {
          value: "straight-skeleton",
          label: "Straight Skeleton"
        },
        {
          value: "thinning",
          label: "Thinning (rectilinear)"
        }
      ]
    },
    {
      key: "samples",
      label: "Samples",
      kind: "range",
      default: 8,
      min: 2,
      max: 20,
      step: 1,
      showWhen: "type == 'sampled-voronoi' || type == 'segment-sweepline'"
    },
    {
      key: "level",
      label: "Level",
      kind: "range",
      default: 1,
      min: 1,
      max: 4,
      step: 1,
      showWhen: "type == 'straight-skeleton'"
    },
    {
      key: "reduceLevel",
      label: "Reduce segments",
      kind: "range",
      default: 0,
      min: 0,
      max: 5,
      step: 1,
      showWhen: "type == 'straight-skeleton'"
    }
  ]
};

// src/floorplan/flow/declarations/bsp.node.json
var bsp_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "bsp",
  meta: {
    label: "BSP",
    category: "Partition",
    color: "#c026d3"
  },
  description: "Binary-space-partition a polygon into cells \u2014 a pure CALCULATION node: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: 'A value-only node: it takes a polygon as a coordinate LIST and returns its BSP cells as a coordinate list. It has no geometry input or output and draws nothing on the canvas or in 3D \u2014 wire val-polygons into a Polygon node when you want the cells drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon.\n\nOUTPUT: val-graph publishes the PARTITION NETWORK as { "nodes": [{ "id", "x", "y" }, ...], "edges": [{ "from_node_id", "to_node_id", "length" }, ...] } \u2014 one edge per cell boundary, deduped so a wall shared by two cells appears once, split at T-junctions. Edges carry NO thickness (BSP is partition-only) \u2014 apply wall thickness downstream with a Set Thickness node. Wire it into a Network node to draw the partition, or into a graph value node to process it.\n\nval-polygons publishes every cell as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nPARTITION: seeds = target cell count; layout / balance / weights / tiltAngle / maxRatio / useConnection shape the split. Every parameter is wireable (valin-*).',
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "seeds",
        label: "Cells"
      },
      {
        key: "tiltAngle",
        label: "Tilt"
      },
      {
        key: "balance",
        label: "Balance"
      },
      {
        key: "weights",
        label: "Weights"
      },
      {
        key: "layout",
        label: "Layout"
      },
      {
        key: "maxRatio",
        label: "Max aspect"
      },
      {
        key: "useConnection",
        label: "Use adjacency"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      },
      {
        key: "graph",
        label: "Graph (JSON)"
      },
      {
        key: "nodeCount",
        label: "Nodes"
      },
      {
        key: "edgeCount",
        label: "Edges"
      }
    ]
  },
  defaults: {
    connections: ""
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "seeds",
      label: "Cells",
      kind: "range",
      default: 3,
      min: 1,
      max: 30,
      step: 1
    },
    {
      key: "tiltAngle",
      label: "Tilt",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "balance",
      label: "Balance",
      kind: "select",
      default: "equal",
      options: [
        {
          value: "equal",
          label: "Equal area"
        },
        {
          value: "weighted",
          label: "Weighted (ratios)"
        }
      ]
    },
    {
      key: "weights",
      label: "Weights",
      kind: "text",
      default: "",
      placeholder: "1, 2, 1",
      showWhen: "balance == 'weighted'"
    },
    {
      key: "layout",
      label: "Layout",
      kind: "select",
      default: "strip",
      options: [
        {
          value: "strip",
          label: "Slicing (BSP)"
        },
        {
          value: "squarify",
          label: "Squarified (treemap)"
        }
      ]
    },
    {
      key: "maxRatio",
      label: "Max aspect",
      kind: "range",
      default: 0,
      min: 0,
      max: 6,
      step: 0.1,
      showWhen: "layout != 'squarify'"
    },
    {
      key: "useConnection",
      label: "Use adjacency",
      kind: "checkbox",
      default: false
    }
  ]
};

// src/floorplan/flow/declarations/corridoor.node.json
var corridoor_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "corridoor",
  meta: {
    label: "Corridoor",
    category: "Partition",
    color: "#0d9488"
  },
  description: "A pure CALCULATION node \u2014 carve a corridor through the polygon: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "shape",
        label: "Shape"
      },
      {
        key: "width",
        label: "Width"
      },
      {
        key: "offset",
        label: "Inset offset"
      },
      {
        key: "count",
        label: "Cells (n)"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  vars: {
    isInset: "shape == 'insetted'",
    isPath: "shape == 'skeleton' || shape == 'bsp' || shape == 'split'"
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "shape",
      label: "Shape",
      kind: "select",
      default: "horizontal",
      options: [
        {
          value: "horizontal",
          label: "Horizontal band"
        },
        {
          value: "vertical",
          label: "Vertical band"
        },
        {
          value: "cross",
          label: "Cross"
        },
        {
          value: "insetted",
          label: "Insetted loop"
        },
        {
          value: "skeleton",
          label: "Skeleton path"
        },
        {
          value: "bsp",
          label: "BSP path"
        },
        {
          value: "split",
          label: "Split path"
        }
      ]
    },
    {
      key: "width",
      label: "Width",
      kind: "range",
      default: 1.2,
      min: 0.1,
      max: 10,
      step: 0.1,
      unit: "m"
    },
    {
      key: "offset",
      label: "Inset offset",
      kind: "range",
      default: 0.5,
      min: 0,
      max: 20,
      step: 0.1,
      unit: "m",
      showWhen: "isInset"
    },
    {
      key: "count",
      label: "Cells (n)",
      kind: "range",
      default: 3,
      min: 2,
      max: 12,
      step: 1,
      showWhen: "isPath"
    }
  ]
};

// src/floorplan/flow/declarations/core-racking.node.json
var core_racking_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "core-racking",
  meta: {
    label: "Core Racking",
    category: "Partition",
    color: "#7c3aed"
  },
  description: "A pure CALCULATION node \u2014 rack fixed-size cores along a corridor: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "length",
        label: "Core length"
      },
      {
        key: "breadth",
        label: "Core breadth"
      },
      {
        key: "gap",
        label: "Gap"
      },
      {
        key: "margin",
        label: "End margin"
      },
      {
        key: "side",
        label: "Side"
      },
      {
        key: "orientation",
        label: "Orientation"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "length",
      label: "Core length",
      kind: "range",
      default: 4,
      min: 0.5,
      max: 20,
      step: 0.1,
      unit: "m"
    },
    {
      key: "breadth",
      label: "Core breadth",
      kind: "range",
      default: 4,
      min: 0.5,
      max: 20,
      step: 0.1,
      unit: "m"
    },
    {
      key: "gap",
      label: "Gap",
      kind: "range",
      default: 0.5,
      min: 0,
      max: 10,
      step: 0.1,
      unit: "m"
    },
    {
      key: "margin",
      label: "End margin",
      kind: "range",
      default: 0,
      min: 0,
      max: 10,
      step: 0.1,
      unit: "m"
    },
    {
      key: "side",
      label: "Side",
      kind: "select",
      default: "both",
      options: [
        {
          value: "both",
          label: "Both sides"
        },
        {
          value: "left",
          label: "Left only"
        },
        {
          value: "right",
          label: "Right only"
        }
      ]
    },
    {
      key: "orientation",
      label: "Orientation",
      kind: "select",
      default: "auto",
      options: [
        {
          value: "auto",
          label: "Auto (run axis)"
        },
        {
          value: "horizontal",
          label: "Horizontal"
        },
        {
          value: "vertical",
          label: "Vertical"
        }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/voronoi.node.json
var voronoi_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "voronoi",
  meta: {
    label: "Voronoi",
    category: "Partition",
    color: "#2563eb"
  },
  description: "Voronoi-partition a polygon into cells \u2014 a pure CALCULATION node: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns its Voronoi cells as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want the cells drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon.\n\nOUTPUT: val-polygons publishes every cell as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nSEEDS: the polygon vertices (useVertices on -> one cell per vertex) or seeds random interior points (off). metric = Euclidean / Manhattan / Chebyshev. relax runs Lloyd/CVT relaxation; rectilinear produces BSP-like axis-aligned cells (concave-safe). Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "metric",
        label: "Type"
      },
      {
        key: "useVertices",
        label: "Use vertices as seeds"
      },
      {
        key: "seeds",
        label: "Seeds"
      },
      {
        key: "relax",
        label: "Relax seeds"
      },
      {
        key: "rectilinear",
        label: "Rectilinear (grid)"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "metric",
      label: "Type",
      kind: "select",
      default: "euclidean",
      options: [
        {
          value: "euclidean",
          label: "Euclidean"
        },
        {
          value: "manhattan",
          label: "Manhattan"
        },
        {
          value: "chebyshev",
          label: "Chebyshev"
        }
      ]
    },
    {
      key: "useVertices",
      label: "Use vertices as seeds",
      kind: "checkbox",
      default: true
    },
    {
      key: "seeds",
      label: "Seeds",
      kind: "range",
      default: 8,
      min: 2,
      max: 40,
      step: 1,
      showWhen: "!useVertices"
    },
    {
      key: "relax",
      label: "Relax seeds",
      kind: "checkbox",
      default: false
    },
    {
      key: "rectilinear",
      label: "Rectilinear (grid)",
      kind: "checkbox",
      default: false
    }
  ]
};

// src/floorplan/flow/declarations/convex-decomp.node.json
var convex_decomp_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "convex-decomp",
  meta: {
    label: "Convex Decomposition",
    category: "Partition",
    color: "#6d28d9"
  },
  description: "Decompose a concave polygon into convex pieces \u2014 a pure CALCULATION node: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns its convex pieces as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want the result drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon.\n\nOUTPUT: val-polygons publishes every piece as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nMETHOD (type): Hertel-Mehlhorn / Bayazit / ACD (approximate, uses tolerance) / Steiner (edge extension) / Neck-cut (a few large blocks, cut only at narrow waists per neckRatio). Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "type",
        label: "Type"
      },
      {
        key: "tolerance",
        label: "Tolerance"
      },
      {
        key: "neckRatio",
        label: "Neck sensitivity"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "type",
      label: "Type",
      kind: "select",
      default: "hertel-mehlhorn",
      options: [
        {
          value: "hertel-mehlhorn",
          label: "Hertel\u2013Mehlhorn"
        },
        {
          value: "bayazit",
          label: "Bayazit"
        },
        {
          value: "acd",
          label: "ACD (approximate)"
        },
        {
          value: "steiner",
          label: "Steiner (edge extension)"
        },
        {
          value: "neck-cut",
          label: "Neck-cut (big blocks)"
        }
      ]
    },
    {
      key: "tolerance",
      label: "Tolerance",
      kind: "range",
      default: 10,
      min: 0,
      max: 40,
      step: 0.5,
      unit: "\xB0",
      showWhen: "type == 'acd'"
    },
    {
      key: "neckRatio",
      label: "Neck sensitivity",
      kind: "range",
      default: 3,
      min: 1.5,
      max: 8,
      step: 0.1,
      showWhen: "type == 'neck-cut'"
    }
  ]
};

// src/floorplan/flow/declarations/mesh.node.json
var mesh_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "mesh",
  meta: {
    label: "Meshing",
    category: "Partition",
    color: "#0f766e"
  },
  description: "Mesh a polygon into cells (triangles / quads) \u2014 a pure CALCULATION node: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns its mesh cells as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want the cells drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon.\n\nOUTPUT: val-polygons publishes every cell as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\ntype selects the meshing scheme. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "type",
        label: "Type"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "type",
      label: "Type",
      kind: "select",
      default: "ear-clipping",
      options: [
        {
          value: "ear-clipping",
          label: "Ear clipping (triangles)"
        },
        {
          value: "cdt",
          label: "Delaunay (CDT)"
        },
        {
          value: "blossom-quad",
          label: "Blossom quad"
        }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/circle-packing.node.json
var circle_packing_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "circle-packing",
  meta: {
    label: "Circle Packing",
    category: "Partition",
    color: "#0ea5e9"
  },
  description: "A pure CALCULATION node \u2014 pack inscribed circles / n-gons: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "count",
        label: "Count"
      },
      {
        key: "minRadius",
        label: "Min radius"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "count",
      label: "Count",
      kind: "range",
      default: 8,
      min: 1,
      max: 50,
      step: 1
    },
    {
      key: "minRadius",
      label: "Min radius",
      kind: "range",
      default: 0.5,
      min: 0,
      max: 20,
      step: 0.1,
      unit: "m"
    },
    {
      key: "sides",
      label: "Sides",
      kind: "range",
      default: 30,
      min: 3,
      max: 30,
      step: 1
    },
    {
      key: "optimizeRotation",
      label: "Optimise rotation",
      kind: "checkbox",
      default: true,
      showWhen: "sides < 30"
    },
    {
      key: "rotation",
      label: "Rotation",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0",
      showWhen: "sides < 30 && !optimizeRotation"
    }
  ]
};

// src/floorplan/flow/declarations/treemap.node.json
var treemap_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "treemap",
  meta: {
    label: "Squarified Treemap",
    category: "Partition",
    color: "#0891b2"
  },
  description: "A pure CALCULATION node \u2014 pack the polygon into a squarified treemap: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "count",
        label: "Cells"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "count",
      label: "Cells",
      kind: "range",
      default: 6,
      min: 1,
      max: 30,
      step: 1
    },
    {
      key: "tiltAngle",
      label: "Tilt",
      kind: "range",
      default: 0,
      min: 0,
      max: 360,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "weights",
      label: "Weights",
      kind: "text",
      default: "",
      placeholder: "1, 2, 1 (blank = equal)"
    },
    {
      key: "showOuterOpenings",
      label: "Show outer openings",
      kind: "checkbox",
      default: false
    },
    {
      key: "outerOpeningWidth",
      label: "Outer opening width",
      kind: "range",
      default: 1,
      min: 0.3,
      max: 3,
      step: 0.05,
      unit: "m",
      showWhen: "showOuterOpenings"
    },
    {
      key: "showInnerOpenings",
      label: "Show inner openings",
      kind: "checkbox",
      default: false
    },
    {
      key: "innerOpeningWidth",
      label: "Inner opening width",
      kind: "range",
      default: 0.9,
      min: 0.3,
      max: 3,
      step: 0.05,
      unit: "m",
      showWhen: "showInnerOpenings"
    }
  ]
};

// src/floorplan/flow/declarations/rect-pack.node.json
var rect_pack_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "rect-pack",
  meta: {
    label: "Rectangle Packing",
    category: "Partition",
    color: "#ea580c"
  },
  description: "Pack rectangles inside a polygon \u2014 a pure CALCULATION node: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the packed rectangles as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want them drawn.\n\nINPUT: polygon takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry val-points into valin-polygon.\n\nOUTPUT: val-polygons publishes every rectangle as a nested [[[x,y],...],...] list, which a Polygon node accepts directly. val-placed (count) and val-utilization (%) are still published.\n\nPACKING: width / height / count / gap / placement / seed / allowRotate / optimiseOrientation / alignToAxis / tilt. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "count",
        label: "Count"
      }
    ],
    valueOutputs: [
      {
        key: "placed",
        label: "Placed"
      },
      {
        key: "utilization",
        label: "Utilization",
        unit: "%"
      },
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "width",
      label: "Width",
      kind: "range",
      default: 6,
      min: 0.5,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "height",
      label: "Height",
      kind: "range",
      default: 9,
      min: 0.5,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "count",
      label: "Count (0 = fill)",
      kind: "range",
      default: 0,
      min: 0,
      max: 200,
      step: 1
    },
    {
      key: "gap",
      label: "Gap",
      kind: "range",
      default: 0,
      min: 0,
      max: 10,
      step: 0.05,
      unit: "m"
    },
    {
      key: "placement",
      label: "Placement",
      kind: "select",
      default: "grid",
      options: [
        {
          value: "grid",
          label: "Grid"
        },
        {
          value: "random",
          label: "Random"
        }
      ]
    },
    {
      key: "seed",
      label: "Seed",
      kind: "number",
      default: 1,
      min: 1,
      step: 1,
      showWhen: "placement == 'random'"
    },
    {
      key: "allowRotate",
      label: "Allow rotation",
      kind: "checkbox",
      default: true
    },
    {
      key: "optimiseOrientation",
      label: "Optimise orientation",
      kind: "checkbox",
      default: false,
      showWhen: "placement != 'random'"
    },
    {
      key: "alignToAxis",
      label: "Align to axis",
      kind: "checkbox",
      default: true,
      showWhen: "placement == 'random' || !optimiseOrientation"
    },
    {
      key: "tilt",
      label: "Tilt",
      kind: "range",
      default: 0,
      min: 0,
      max: 180,
      step: 1,
      unit: "\xB0",
      showWhen: "(placement == 'random' || !optimiseOrientation) && !alignToAxis"
    }
  ]
};

// src/floorplan/flow/declarations/visibility.node.json
var visibility_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "visibility",
  meta: {
    label: "Visibility Polygon",
    category: "Partition",
    color: "#65a30d"
  },
  description: "A pure CALCULATION node \u2014 compute the visibility region from a viewpoint: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "x",
        label: "Viewer X"
      },
      {
        key: "y",
        label: "Viewer Y"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "mode",
      label: "Type",
      kind: "select",
      default: "point",
      options: [
        {
          value: "point",
          label: "Point (viewer)"
        },
        {
          value: "segment",
          label: "Segment (edge)"
        }
      ]
    },
    {
      key: "x",
      label: "Viewer X",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m",
      showWhen: "mode != 'segment'"
    },
    {
      key: "y",
      label: "Viewer Y",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m",
      showWhen: "mode != 'segment'"
    },
    {
      key: "edgeIndex",
      label: "Edge",
      kind: "range",
      default: 0,
      min: 0,
      max: 19,
      step: 1,
      showWhen: "mode == 'segment'"
    }
  ]
};

// src/floorplan/flow/declarations/source.node.json
var source_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "source",
  meta: {
    label: "Space",
    category: "Space",
    color: "#0f172a"
  },
  description: "Pipeline input \u2014 a Space on the canvas (by id, or the current selection).",
  instructions: "GEOMETRY NODE: this is the single \"Geometry\" node \u2014 there is no kind selector, because THE CANVAS SELECTION IS THE SELECTOR. With \"Grab ID from selection\" on, selecting a canvas node makes it a Point source, a segment makes it a Segment source, a graph a Graph source, a space a Space source and a picture an Image source; the node keeps its id, name, position and wires across the change. That is what lets one input carry a host whose TYPE changes \u2014 the anchor of a parametric object stays wired while you switch from a node to a wall to a room. Turn the toggle off and type an id to pin it to one element. (Freehand is not selection-driven \u2014 its strokes are matched by colour \u2014 so it stays its own node.)\n\nEvery kind publishes its geometry in the same anchor-relative metre frame: a point list on `val-points` (Point \u2192 one row, Segment \u2192 two, Space \u2192 its outline) or nodes+links on `val-graph` (Graph, Freehand).\n\nThe primary pipeline ROOT \u2014 feeds a Space from the canvas into the flow. `id` identifies the source Space; with 'Grab ID from selection' on, the id stays synced to the space currently selected on the canvas (and feeds that space's geometry). Geometry always comes from the canvas, never from the wire.\n\nThe input endpoint accepts a Schema node to attach Space schema properties to the referenced space(s) \u2014 the node itself stays a root (incoming geometry is ignored).\n\nTIP: turn grab OFF and type an id to pin a specific Space regardless of selection.\n\nVALUE OUTPUT: `val-points` publishes the resolved outline as a `[[x,y],\u2026]` metre list, anchor-relative \u2014 the SAME list Space Geometry emits on its own `val-points`. So a value chain (Math Engine, the Matrix nodes, Input Properties) can hang straight off the Space and the Space Geometry hop is optional; add Space Geometry when you also want area / perimeter / vertex count. With several spaces referenced, the FIRST one is published (matching Space Geometry).\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nCANVAS JSON. `val-canvasJson` publishes the WHOLE canvas as the model behind the drawing \u2014 every wall, door, window and object with its real position, dimensions and `semantics`, the payload the Plan JSON node used to be a separate node for. It is deliberately NOT scoped to this node's own geometry: this node says what the region IS, and narrowing the payload to that region is Filter by Space's job (wire this output into its `json` input and the region into its geometry input). One node now answers both halves \u2014 the shape on the geometry output, the model on this one \u2014 so a flow can no longer hold two nodes with two different ideas of which room it means.\n\nID. `val-id` publishes the id of the element this node resolves \u2014 `space-\u2026`, `segment-\u2026`, `node-\u2026`, each naming its own kind, and the SAME string the canvas shows, an export writes and this node's own ID field holds. Wire it into a Prompt Builder slot, an Output slot or an Input Properties text parameter to say WHICH element a run was about, rather than describing it by its coordinates. With several elements grabbed it is the comma-separated list, in the order they were selected; with nothing resolved it is empty.",
  handles: {
    input: true,
    output: true,
    valueOutputs: [
      {
        key: "id",
        label: "ID"
      },
      {
        key: "points",
        label: "Vertices (list)"
      },
      {
        key: "canvasJson",
        label: "Canvas JSON"
      }
    ]
  },
  parameters: [
    {
      key: "grabFromSelection",
      label: "Grab ID from selection",
      kind: "checkbox",
      default: true
    },
    {
      key: "id",
      label: "ID",
      kind: "text",
      default: "",
      placeholder: "space id",
      showWhen: "!grabFromSelection"
    }
  ]
};

// src/floorplan/flow/declarations/space-creator.node.json
var space_creator_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "space-creator",
  meta: { label: "Space Creator", category: "Space", color: "#0f766e" },
  description: "Draw a parametric space \u2014 rectangle / regular polygon / circle / L-shape, regular or irregular.",
  instructions: "A generator (no geometry input) \u2014 synthesises a parametric polygon Space from scratch: shape + dimensions + rotation + regular/irregular. Acts as a pipeline root like the Space node, but draws its geometry (centred near the current selection, offset by offsetX/offsetY). Irregular jitter is seeded \u2192 stable; Re-roll bumps the seed.\n\nOnly the fields relevant to the shape show (Rectangle/L-shape \u2192 width \xD7 height; Regular polygon \u2192 segments n + radius; Circle \u2192 radius).\n\nTIP: use it as a test Space or a parametric footprint to feed Inset / Split / Optimise Rectangle.",
  handles: { input: false, output: true },
  parameters: [
    {
      key: "shape",
      label: "Shape",
      kind: "select",
      default: "rectangle",
      options: [
        { value: "rectangle", label: "Rectangle" },
        { value: "polygon", label: "Regular polygon" },
        { value: "circle", label: "Circle" },
        { value: "lshape", label: "L-shape" }
      ]
    },
    { key: "n", label: "Segments (n)", kind: "range", default: 5, min: 3, max: 40, step: 1, showWhen: "shape == 'polygon'" },
    { key: "radius", label: "Radius", kind: "range", default: 3, min: 0.5, max: 50, step: 0.5, unit: "m", showWhen: "shape == 'polygon' || shape == 'circle'" },
    { key: "width", label: "Width", kind: "range", default: 4, min: 0.5, max: 100, step: 0.5, unit: "m", showWhen: "shape == 'rectangle' || shape == 'lshape'" },
    { key: "height", label: "Height", kind: "range", default: 3, min: 0.5, max: 100, step: 0.5, unit: "m", showWhen: "shape == 'rectangle' || shape == 'lshape'" },
    { key: "rotation", label: "Rotation", kind: "range", default: 0, min: 0, max: 360, step: 1, unit: "\xB0" },
    {
      key: "regularity",
      label: "Regularity",
      kind: "select",
      default: "regular",
      options: [
        { value: "regular", label: "Regular" },
        { value: "irregular", label: "Irregular" }
      ]
    },
    { key: "irregularity", label: "Irregularity", kind: "range", default: 0.3, min: 0, max: 1, step: 0.02, showWhen: "regularity == 'irregular'" },
    { key: "seed", label: "Seed", kind: "number", default: 1, min: 1, step: 1, showWhen: "regularity == 'irregular'" },
    { key: "offsetX", label: "Offset X", kind: "number", default: 0, step: 0.5, unit: "m" },
    { key: "offsetY", label: "Offset Y", kind: "number", default: 0, step: 0.5, unit: "m" }
  ]
};

// src/floorplan/flow/declarations/pull.node.json
var pull_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "pull",
  meta: {
    label: "Pull",
    category: "Space",
    color: "#ca8a04"
  },
  description: "A pure CALCULATION node \u2014 pull two polygons together (or apart): coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes TWO polygons as coordinate LISTS and returns both moved outlines as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want them drawn.\n\nINPUT: polygon = outline A, polygonB = outline B, each JSON [[x,y],...] metre pairs local to the anchor. Wire Space Geometry val-points into each.\n\nOUTPUT: val-polygons publishes BOTH results as a nested [[[x,y],...],...] list \u2014 A first, then B.\n\nmode / anchor / contact / distance / edgeSlide control the pull. Every parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "polygonB",
        label: "Polygon B"
      },
      {
        key: "distance",
        label: "Distance"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "polygonB",
      label: "Polygon B (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "touch",
      options: [
        {
          value: "touch",
          label: "Touch"
        },
        {
          value: "distance",
          label: "Distance (gap)"
        },
        {
          value: "centroid",
          label: "Centroid"
        }
      ]
    },
    {
      key: "contact",
      label: "Contact",
      kind: "select",
      default: "point",
      options: [
        {
          value: "point",
          label: "Point (closest)"
        },
        {
          value: "edge-flush",
          label: "Edge flush"
        }
      ],
      showWhen: "mode != 'centroid'"
    },
    {
      key: "distance",
      label: "Gap",
      kind: "range",
      default: 0.5,
      min: 0,
      max: 10,
      step: 0.05,
      unit: "m",
      showWhen: "mode == 'distance'"
    },
    {
      key: "anchor",
      label: "Move",
      kind: "select",
      default: "both",
      options: [
        {
          value: "both",
          label: "Both"
        },
        {
          value: "A",
          label: "A only"
        },
        {
          value: "B",
          label: "B only"
        }
      ]
    },
    {
      key: "edgeSlide",
      label: "Edge slide",
      kind: "checkbox",
      default: true,
      showWhen: "mode != 'centroid' && contact == 'edge-flush'"
    }
  ]
};

// src/floorplan/flow/declarations/transform.node.json
var transform_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "transform",
  meta: {
    label: "Transform",
    category: "Space",
    color: "#7e22ce"
  },
  description: "A pure CALCULATION node \u2014 move / rotate / scale the polygon: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon. A nested [[[x,y],...],...] list is accepted too \u2014 the LARGEST piece is used, since this node works on one polygon.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      },
      {
        key: "rotate",
        label: "Rotate"
      },
      {
        key: "scale",
        label: "Scale"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "translateX",
      label: "Move X",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "translateY",
      label: "Move Y",
      kind: "range",
      default: 0,
      min: -50,
      max: 50,
      step: 0.1,
      unit: "m"
    },
    {
      key: "rotate",
      label: "Rotate",
      kind: "range",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
      unit: "\xB0"
    },
    {
      key: "scale",
      label: "Scale",
      kind: "range",
      default: 1,
      min: 0.1,
      max: 5,
      step: 0.05
    },
    {
      key: "mirror",
      label: "Mirror",
      kind: "select",
      default: "none",
      options: [
        {
          value: "none",
          label: "None"
        },
        {
          value: "x",
          label: "Across X"
        },
        {
          value: "y",
          label: "Across Y"
        },
        {
          value: "custom",
          label: "Custom line"
        },
        {
          value: "edge",
          label: "Across edge"
        }
      ]
    },
    {
      key: "mirrorAngle",
      label: "Mirror angle",
      kind: "range",
      default: 0,
      min: 0,
      max: 180,
      step: 1,
      unit: "\xB0",
      showWhen: "mirror == 'custom'"
    },
    {
      key: "mirrorEdge",
      label: "Edge #",
      kind: "range",
      default: 0,
      min: 0,
      max: 50,
      step: 1,
      showWhen: "mirror == 'edge'"
    },
    {
      key: "anchor",
      label: "Anchor",
      kind: "select",
      default: "each-centroid",
      options: [
        {
          value: "each-centroid",
          label: "Each centroid"
        },
        {
          value: "vertex",
          label: "Vertex"
        },
        {
          value: "group-centroid",
          label: "Group centroid"
        },
        {
          value: "origin",
          label: "Origin (0,0)"
        }
      ]
    },
    {
      key: "anchorVertex",
      label: "Vertex #",
      kind: "range",
      default: 0,
      min: 0,
      max: 50,
      step: 1,
      showWhen: "anchor == 'vertex'"
    }
  ]
};

// src/floorplan/flow/declarations/dimension.node.json
var dimension_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "dimension",
  meta: { label: "Linear Dimension", category: "Space", color: "#1d4ed8" },
  description: "Dimension a Space's edges \u2014 Outer/inner placement at an Offset. All edges, or Edgewise to tick which edges. Forwards the Space on.",
  instructions: "Dimensions the EDGES of each incoming Space \u2014 every edge gets its own length dimension, placed Outer (outside the space) or inner, standing off by `offset` (m). The Space is forwarded unchanged downstream.\n\nMODE (`mode`)\n\u2022 all \u2014 dimension every edge.\n\u2022 edgewise \u2014 dimension only the ticked edges (a checkbox grid renders on the node).\n\n`style` sets the end markers (ticks / arrowheads / dots); `units` = metric metres or architectural feet-inches; `extension` is the witness-line overrun; `precision` the metric decimals.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "offset", label: "Offset" }
    ]
  },
  defaults: { edges: "" },
  parameters: [
    { key: "outer", label: "Outer", kind: "checkbox", default: true },
    { key: "offset", label: "Offset", kind: "range", default: 1, min: 0, max: 10, step: 0.1, unit: "m" },
    {
      key: "style",
      label: "Style",
      kind: "select",
      default: "ticks",
      options: [
        { value: "ticks", label: "Ticks (45\xB0)" },
        { value: "arrowhead", label: "Arrowheads" },
        { value: "dot", label: "Dots" }
      ]
    },
    {
      key: "mode",
      label: "Mode",
      kind: "select",
      default: "all",
      options: [
        { value: "all", label: "All edges" },
        { value: "edgewise", label: "Edgewise (pick edges)" }
      ]
    },
    {
      key: "units",
      label: "Units",
      kind: "select",
      default: "metric",
      options: [
        { value: "metric", label: "Metric (m)" },
        { value: "imperial", label: "Feet-inches" }
      ]
    },
    { key: "extension", label: "Witness overrun", kind: "range", default: 0.3, min: 0, max: 2, step: 0.05, unit: "m" },
    { key: "precision", label: "Decimals", kind: "range", default: 2, min: 0, max: 4, step: 1, showWhen: "units != 'imperial'" }
  ]
};

// src/floorplan/flow/declarations/area-dimension.node.json
var area_dimension_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "area-dimension",
  meta: { label: "Area Dimension", category: "Space", color: "#0e7490" },
  description: "Annotate each Space at its centroid with Label \xB7 Area \xB7 L\xD7B dimension, in m / cm / ft. Forwards the Space on.",
  instructions: "Writes a centred annotation block into each incoming Space \u2014 Label, Area and the bounding L \xD7 B dimension \u2014 in the chosen `unit` (m / cm / ft). The Space is forwarded unchanged downstream.\n\nToggle `showLabel` / `showArea` / `showDimension` to pick which lines appear; `label` is the optional first-line text.\n\nTIP: chain it after room-generating nodes to tag each Space with its name + area for a schedule.",
  handles: { input: true, output: true },
  parameters: [
    {
      key: "unit",
      label: "Unit",
      kind: "select",
      default: "m",
      options: [
        { value: "m", label: "Metres (m)" },
        { value: "cm", label: "Centimetres (cm)" },
        { value: "ft", label: "Feet (ft)" }
      ]
    },
    { key: "label", label: "Label", kind: "text", default: "", placeholder: "e.g. Living", showWhen: "showLabel" },
    { key: "showLabel", label: "Show label", kind: "checkbox", default: true },
    { key: "showArea", label: "Show area", kind: "checkbox", default: true },
    { key: "showDimension", label: "Show dimension (L\xD7B)", kind: "checkbox", default: true }
  ]
};

// src/floorplan/flow/declarations/schema.node.json
var schema_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "schema",
  meta: { label: "Input Schema", category: "Space", color: "#7c3aed" },
  description: "Define per-component input properties (Node / Segment / Space / Graph). Wire the output into a Graph or Space node to attach them \u2014 they surface in each component's Properties tab. The left params input can take a node's params (e.g. Display Node) to derive a schema from its fields.",
  instructions: "A general component-property schema, edited inline on the node via four foldable sections \u2014 Node / Segment / Space / Graph \u2014 each a list of parameters (label, type, unit, default, min/max/step, options, solver role) like the Input Properties node.\n\nWire its OUTPUT into a Graph node to attach the Node/Segment/Graph properties to that graph's components, or into a Space node to attach the Space properties \u2014 they then appear in each component's Properties tab (added to the built-ins, never replacing them). The `pin` params input can take a node's params output (e.g. Display Node) to derive the schema from that node's fields.\n\nNOTE: the four sections are edited by the on-node schema editor; `name` is an optional label.",
  handles: {
    input: false,
    output: true,
    acceptsParams: true
  },
  defaults: { nodeProps: [], segmentProps: [], spaceProps: [], graphProps: [] },
  parameters: [
    { key: "name", label: "Name", kind: "text", default: "", placeholder: "Schema name (optional)" }
  ]
};

// src/floorplan/flow/declarations/output-schema.node.json
var output_schema_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "output-schema",
  meta: { label: "Output Schema", category: "Space", color: "#9333ea" },
  description: "Define which solver results show per component (Node / Segment / Space / Graph). Wire a solver's output into this node \u2014 row keys match the solver's result keys; label/unit/step style the Metrics rows.",
  instructions: "A terminal (input only) \u2014 defines which RESULT rows a solver publishes into each component's Metrics tab, via the same four foldable sections as Input Schema (Node / Segment / Space / Graph).\n\nWire a solver's output (e.g. Pipe Network Solver) into it: each row's key must MATCH a result the solver writes (e.g. node head / pressure; segment discharge / velocity / headloss / unitHeadloss); label/unit set the display, step sets the decimals.\n\nNOTE: the four sections are edited by the on-node schema editor; `name` is an optional label.",
  handles: {
    input: true,
    output: false
  },
  defaults: { nodeProps: [], segmentProps: [], spaceProps: [], graphProps: [] },
  parameters: [
    { key: "name", label: "Name", kind: "text", default: "", placeholder: "Schema name (optional)" }
  ]
};

// src/floorplan/flow/declarations/layout-gen.node.json
var layout_gen_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "layout-gen",
  meta: { label: "Layout Generation", category: "Space", color: "#9333ea" },
  description: "Generate a multi-room layout inside the wired Space \u2014 set each room's Min/Max area + max aspect Ratio. Draggable seeds + connection/repulsion lines on the canvas; each room's Area/Ratio is colour-coded green (ok) / red (violated). Run Annealing to optimise.",
  instructions: "A front-end to the interactive floorplan generator. Wire a Space (boundary) into the input, set the rooms / algorithm / connections / repulsions, then press Generate \u2014 the host runs the generator and loads it as the canvas's editable layout (draggable seeds, connection/repulsion lines, Add Room all work on the canvas). Run Annealing optimises the seed positions.\n\nThe `rooms` list (label + min/max area + max aspect ratio) is edited by the on-node rooms editor; the canvas colour-codes each generated room's Area / Ratio against it (green ok / red violated). `algorithm` = BSP (recursive split) or RDG (room graph). Room count / floor area / SA score are published for an Output node.",
  handles: {
    input: true,
    output: true,
    valueInputs: [
      { key: "wallWidth", label: "Wall width" },
      { key: "saIterations", label: "SA iterations" }
    ],
    valueOutputs: [
      { key: "rooms", label: "Rooms" },
      { key: "area", label: "Floor area", unit: "m\xB2" },
      { key: "score", label: "SA score" }
    ]
  },
  defaults: {
    rooms: [
      { label: "Living", minArea: 18, maxArea: 0, maxRatio: 2.5 },
      { label: "Kitchen", minArea: 8, maxArea: 0, maxRatio: 2.5 },
      { label: "Bedroom", minArea: 12, maxArea: 0, maxRatio: 2.5 },
      { label: "Bathroom", minArea: 4, maxArea: 0, maxRatio: 3 }
    ]
  },
  parameters: [
    {
      key: "algorithm",
      label: "Algorithm",
      kind: "select",
      default: "bsp",
      options: [
        { value: "bsp", label: "BSP (recursive split)" },
        { value: "rdg", label: "RDG (room graph)" }
      ]
    },
    { key: "wallWidth", label: "Wall Width", kind: "range", default: 0.15, min: 0.05, max: 0.4, step: 0.01, unit: "m" },
    { key: "connections", label: "Connections (A-B, \u2026)", kind: "text", default: "Living-Kitchen, Living-Bedroom", placeholder: "Living-Kitchen, Living-Bedroom" },
    { key: "repulsions", label: "Repulsions (A-B, \u2026)", kind: "text", default: "", placeholder: "Kitchen-Bathroom" },
    { key: "saIterations", label: "SA Iterations", kind: "range", default: 600, min: 50, max: 3e3, step: 50 }
  ]
};

// src/floorplan/flow/declarations/schema-to-drawing.node.json
var schema_to_drawing_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "schema-to-drawing",
  meta: { label: "Schema to Drawing Tools", category: "Space", color: "#9333ea" },
  description: "Bring an attached Schema's segment & node TYPES (with icons) into the Add Segment / Add Node drawing dropdowns.",
  instructions: "Reads an attached Schema's segment `type` (role seg-type) and node `type` (role node-type) discriminators \u2014 their options + per-option icons \u2014 and surfaces them to the host so they appear as tools in the Add Segment / Add Node drawing dropdowns (augmenting and overriding the built-ins by value). Wire a Schema into the Schema input. No geometry output.",
  handles: {
    input: true,
    output: false,
    geomInputs: [
      { key: "schema", label: "Schema" }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/schema-to-layers.node.json
var schema_to_layers_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "schema-to-layers",
  meta: { label: "Schema to Layers", category: "Space", color: "#9333ea" },
  description: "Bring an attached Schema's segment & node TYPES into the Layers panel as foldable Segment / Node layer blocks.",
  instructions: "Reads an attached Schema's segment `type` (role seg-type) and node `type` (role node-type) discriminators \u2014 their options \u2014 and surfaces them to the host as live LAYER blocks: a foldable 'Segment' block (Wall / Door / Window / Line) and 'Node' block (Junction / Object) in the Layers panel. Live-derived (not saved); removing the node returns the panel to just Layer 0. Wire a Schema into the Schema input. No geometry.",
  handles: {
    input: true,
    output: false,
    geomInputs: [
      { key: "schema", label: "Schema" }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/hatching.node.json
var hatching_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "hatching",
  meta: { label: "Display Space", category: "Space", color: "#475569" },
  description: "Paint the input Space with a colour fill or diagonal/dots hatch (passes the space through).",
  instructions: "A pure styling node \u2014 takes a Space, passes its geometry straight through (so the pipeline continues), and paints a coloured fill / hatch over it in the live preview. With `hatch` off it's a flat `color` fill at `opacity`; with hatch on, a diagonal-line or random-dot pattern (spacing / angle / weight controls). Mirrors the Display block's hatch styling.\n\nTIP: use it to colour-code Spaces (zoning studies) without altering geometry.",
  handles: { input: true, output: true },
  parameters: [
    { key: "color", label: "Color", kind: "color", default: "#0ea5e9" },
    { key: "opacity", label: "Opacity", kind: "range", default: 0.5, min: 0, max: 1, step: 0.05 },
    { key: "hatch", label: "Hatch", kind: "checkbox", default: true },
    {
      key: "hatchStyle",
      label: "Style",
      kind: "select",
      default: "diagonal",
      options: [
        { value: "diagonal", label: "Diagonal lines" },
        { value: "dots", label: "Random dots" }
      ],
      showWhen: "hatch"
    },
    { key: "spacing", label: "Spacing", kind: "range", default: 8, min: 3, max: 40, step: 1, unit: "px", showWhen: "hatch" },
    { key: "angle", label: "Angle", kind: "range", default: 45, min: 0, max: 180, step: 1, unit: "\xB0", showWhen: "hatch && hatchStyle == 'diagonal'" },
    { key: "weight", label: "Weight", kind: "range", default: 1, min: 0.5, max: 5, step: 0.5, unit: "px", showWhen: "hatch" }
  ]
};

// src/floorplan/flow/declarations/space-geometry.node.json
var space_geometry_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "space-geometry",
  meta: {
    label: "Space Geometry",
    category: "Space",
    color: "#0891b2"
  },
  description: "Measure the input space \u2014 outputs Area, Perimeter, vertex count and the vertex list.",
  instructions: "Measures the input Space. Forwards the polygon unchanged on the main output (so it can sit inline in a pipeline) and exposes four value outputs: `val-area` (m\xB2), `val-perimeter` (m), `val-vertices` (count) and `val-points` \u2014 the vertex LIST as [[x,y],\u2026] metre pairs.\n\nWire `val-points` into a Vertices node (to carry the list on) or a Polygon node (to draw it). The list is CENTROID-RELATIVE (metres), matching how every 2D primitive draws local to its anchor \u2014 so the shape is preserved and lands on the consumer's anchor.\n\nTIP: wire val-area into a Math node (e.g. area \xF7 target \u2192 count), or into an Output node's Metrics.",
  handles: {
    input: true,
    output: true,
    valueOutputs: [
      {
        key: "area",
        label: "Area",
        unit: "m\xB2"
      },
      {
        key: "perimeter",
        label: "Perimeter",
        unit: "m"
      },
      {
        key: "vertices",
        label: "Vertices"
      },
      {
        key: "points",
        label: "Vertices (list)"
      }
    ]
  },
  parameters: []
};

// src/floorplan/flow/declarations/merge.node.json
var merge_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "merge",
  meta: {
    label: "Merge",
    category: "Space",
    color: "#16a34a"
  },
  description: "A pure CALCULATION node \u2014 union several polygons into one outline: coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes a polygon as a coordinate LIST and returns the result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `polygon` takes the outline as JSON [[x,y],...] metre pairs, local to the anchor. Wire Space Geometry's val-points into valin-polygon.\n\nMERGE takes the WHOLE set: feed it a nested [[[x,y],...],...] list (from Split / Voronoi / BSP ...) and every piece is unioned. A single flat outline is accepted as a one-element set.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list, which a Polygon node accepts directly.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "polygon",
        label: "Polygon"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "polygon",
      label: "Polygon (JSON)",
      kind: "text",
      default: ""
    }
  ]
};

// src/floorplan/flow/declarations/boolean-2d.node.json
var boolean_2d_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "boolean-2d",
  meta: {
    label: "Boolean 2D",
    category: "Space",
    color: "#7e22ce"
  },
  description: "A pure CALCULATION node \u2014 boolean of two 2D shapes: Union \xB7 Subtract \xB7 Intersect \xB7 XOR. Coordinates in, coordinates out. Draws nothing on canvas.",
  instructions: "A value-only node: it takes two shapes A and B as coordinate lists and returns the boolean result as a coordinate list. It has no geometry input or output and draws nothing on the canvas \u2014 wire val-polygons into a Polygon node when you want it drawn.\n\nINPUT: `a` (Shape A) and `b` (Shape B) each take an outline as JSON [[x,y],...] metre pairs, OR a nested list [[[x,y],...],...]; a nested list is read with the EVEN-ODD rule, so a Mitered-Join poch\xE9 (outer + room holes) is treated as a holed shape, not a solid fill. Wire val-polygons / val-points into valin-a and valin-b.\n\nOP: Union (A \u222A B) merges; Subtract (A \u2212 B) cuts B out of A; Intersect (A \u2229 B) keeps the overlap; XOR keeps the non-overlap. Order matters for Subtract \u2014 A is the main shape, B the tool.\n\nOUTPUT: val-polygons publishes the result as a nested [[[x,y],...],...] list (outer + hole rings), which a Polygon node draws even-odd.\n\nEvery parameter is wireable (valin-*).",
  handles: {
    input: false,
    output: false,
    valueInputs: [
      {
        key: "a",
        label: "Shape A"
      },
      {
        key: "b",
        label: "Shape B"
      },
      {
        key: "op",
        label: "Operation"
      }
    ],
    valueOutputs: [
      {
        key: "polygons",
        label: "Polygons (JSON)"
      }
    ]
  },
  parameters: [
    {
      key: "a",
      label: "Shape A (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "b",
      label: "Shape B (JSON)",
      kind: "text",
      default: ""
    },
    {
      key: "op",
      label: "Operation",
      kind: "select",
      default: "union",
      options: [
        { value: "union", label: "Union (A \u222A B)" },
        { value: "subtract", label: "Subtract (A \u2212 B)" },
        { value: "intersect", label: "Intersect (A \u2229 B)" },
        { value: "xor", label: "XOR (A \u2295 B)" }
      ]
    }
  ]
};

// src/floorplan/flow/declarations/input-props.node.json
var input_props_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "input-props",
  meta: {
    label: "Input Properties",
    category: "Space",
    color: "#9333ea"
  },
  description: "Define adjustable parameters (slider / options / checkbox / text / colour); each exposes its value as an output.",
  instructions: "Takes a Space (forwarded unchanged on the main output) and exposes user-defined adjustable parameters \u2014 each renders its own control (slider / options / checkbox / textbox / colour swatch) and publishes its current value as a `val-<propId>` output endpoint on the right. The value-output handles are DYNAMIC (built from the `props` list edited on the node), not fixed.\n\nAn Options param takes a comma-separated list (`equal, front-remaining`); a Colour param publishes its `#rrggbb` string, so wire it into a `valin-color` endpoint (Rectangle / Circle \u2026) to drive a node's tint.\n\nTIP: use it as a control panel \u2014 define a param once and wire its value into several nodes (e.g. an offset that drives Inset AND Split).\n\nEVERY PARAMETER IS ALSO AN INPUT. Each parameter grows a matching endpoint on the LEFT (`valin-<propId>`, on the same row as its `val-<propId>` output), and a value wired in OVERRIDES that parameter's own control \u2014 so a brief can be driven from upstream just as every op's params can: a computed number from a Math Engine, a value from another params node, an Agent's suggestion. Add a parameter and both endpoints appear; delete it and both go.\n\u2022 The control is REPLACED by a read-only \"wired\" readout of the incoming value while a wire is attached. The stored value is left untouched, so unplugging the wire restores it \u2014 nothing is baked over.\n\u2022 A SELECT parameter resolves its option across the wire by value, label or INDEX, so wiring the number 2 into a three-option parameter selects the third; a CHECKBOX takes any non-zero number as on.\n\u2022 Unwired parameters behave exactly as before.\n\nGEOMETRY THROUGH A PARAMETER. There is no dedicated geometry endpoint \u2014 a parameter of type TEXT is the pass-through. Wire a source's `val-points` (Space / Node / Segment) or `val-graph` (Graph / Freehand) into that parameter's `valin-<id>` and it comes back out on `val-<id>` unchanged, ready for a Math Engine (which lifts anything that parses as a rectangular array into a real matrix). That is what lets the brief sit INLINE \u2014 Space \u2192 Input Properties \u2192 Math Engine \u2192 Polygon \u2014 instead of hanging off the root on a backwards association edge. Name the parameter after the expression variable it feeds (`P`) and the wire reads as one line. See Workflows/Operations/inset_with_math.json.\n\nONE WIRE INSTEAD OF MANY: a Math Engine's `deps` endpoint merges this node's whole value set into scope BY NAME \u2014 the geometry parameter included \u2014 so `Input Properties \u2192 deps` can replace one wire per value, provided the expression names its variables after the parameter ids. An explicit `valin-<var>` wire still overrides deps, so mix the two freely.\n\nFOLDING: value endpoints are hidden while a node is collapsed \u2014 a parameter's own and any declared one alike; only the main geometry in / out handles stay on the title bar. Folding a params node therefore un-anchors its value wires visually. The graph keeps them and the flow still evaluates.\n\nPROPERTIES TAB: this node still surfaces as the component's brief when it sits immediately downstream of the root (the panel's fallback path collects the nodes a root FEEDS), so the inline shape needs no association edge to show its sliders on the Space.",
  handles: {
    input: true,
    output: true
  },
  defaults: {
    props: []
  },
  parameters: []
};

// src/floorplan/flow/declarations/agent.node.json
var agent_node_default = {
  kind: "flow-node",
  version: 2,
  tool: "agent",
  meta: { label: "Agent", category: "AI", color: "#7c3aed" },
  description: "Sets parameters on the nodes CONNECTED to it by analysing the Space wired into its input. Wire Space \u2192 Agent \u2192 Corridoor \u2192 Core Racking; geometry passes through untouched. Edit Instructions (the persona) and Prompt, press Run: it reads the space's metrics + each connected node's parameter schema, then writes confident values straight into those nodes and publishes each as a val-<key> output. Nodes wired from those outputs count as connected too. The model runs ONLY on Run \u2014 never during evaluation \u2014 so once values are baked the flow re-runs identically and this node can be deleted with the values left in place. Changing the space, text or chain marks the result stale. Key and model come from the Chat AI preferences.",
  handles: {
    input: true,
    output: true
  },
  parameters: [
    { key: "instructions", label: "Instructions", kind: "textarea", rows: 10, default: "", placeholder: "Paste the persona here \u2014 what judgement should it apply?" },
    { key: "prompt", label: "Prompt", kind: "textarea", rows: 3, default: "", placeholder: "e.g. 120-person startup office, open plan\u2026" },
    { key: "rounds", label: "Refine rounds", kind: "range", default: 1, min: 1, max: 5, step: 1 }
  ],
  defaults: { props: [], rationale: "", inputHash: "" }
};

// src/floorplan/flow/flowTypes.ts
var GEOMETRY_KINDS = [
  { value: "point", label: "Point (node)", tool: "node-source" },
  { value: "segment", label: "Segment", tool: "segment-source" },
  { value: "space", label: "Space", tool: "source" },
  { value: "graph", label: "Graph", tool: "graph-source" },
  { value: "freehand", label: "Freehand", tool: "freehand-source" },
  // A picture is a canvas element like the rest now — it carries an `image_<uid>`, it has its own select
  // scope, and it answers to Grab from selection — so it belongs in the same node rather than beside it.
  // Selecting one retargets a grabbing Geometry node onto the Image kernel, whose outputs are the raster
  // ones: `val-image` (the data URL), `val-matrix`, and the underlay's placement in metres. It publishes
  // no `val-points`, which is the honest answer to "what are this thing's vertices" for a photograph.
  { value: "image", label: "Image", tool: "image" }
];
var GEOMETRY_TOOL_BY_KIND = Object.fromEntries(GEOMETRY_KINDS.map((k) => [k.value, k.tool]));
var GEOMETRY_KIND_BY_TOOL = Object.fromEntries(GEOMETRY_KINDS.map((k) => [k.tool, k.value]));
var PLACE_OBJECT_DEFAULT_ENTRY = { kind: "bed", length: 2, breadth: 1.6, position: 25, setback: 0, height: 0.5, clearance: 0 };
var PLACE_OBJECT_KIND_OPTIONS = [
  { value: "bed", label: "Bed" },
  { value: "table", label: "Table" },
  { value: "chair", label: "Chair" },
  { value: "sofa", label: "Sofa" },
  { value: "desk", label: "Desk" },
  { value: "wardrobe", label: "Wardrobe" },
  { value: "bookshelf", label: "Bookshelf" },
  { value: "bench", label: "Bench" },
  { value: "piano", label: "Piano" },
  { value: "tv-unit", label: "TV Unit" },
  { value: "fridge", label: "Fridge" },
  { value: "toilet", label: "Toilet" },
  { value: "bathtub", label: "Bathtub" },
  { value: "guitar", label: "Guitar" },
  { value: "whiteboard", label: "Whiteboard" },
  { value: "flute", label: "Flute" },
  { value: "clock", label: "Clock" },
  { value: "mirror", label: "Mirror" }
];
var FLOW_TOOLS = {
  // Data-declared (see ./declarations/source.node.json) — behaviour stays in code.
  source: buildToolDefFromDeclaration(source_node_default),
  // Data-declared (see ./declarations/space-creator.node.json) — behaviour stays in code.
  "space-creator": buildToolDefFromDeclaration(space_creator_node_default),
  // Data-declared (see ./declarations/densify.node.json) — behaviour stays in code (evalDensify).
  densify: buildToolDefFromDeclaration(densify_node_default),
  // Data-declared (see ./declarations/loop.node.json) — behaviour in code (evalLoop): array the input N times.
  loop: buildToolDefFromDeclaration(loop_node_default),
  // Data-declared — value node (computeMatch in evaluateFlow): select-equality → 1/0 gate.
  match: buildToolDefFromDeclaration(match_node_default),
  // Data-declared — behaviour in the host's primitiveMasses walk (FloorPlanEditor): array a 3D primitive.
  "loop-3d": buildToolDefFromDeclaration(loop_3d_node_default),
  // Data-declared (see ./declarations/inset.node.json) — behaviour stays in code (evalInset).
  inset: buildToolDefFromDeclaration(inset_node_default),
  // PROTOTYPE — built from ./declarations/optimise-rect.node.json (params schema + handles + showWhen +
  // instructions), NOT a hand-written literal. Behaviour stays in code: evaluateFlow dispatches this
  // `tool` to evalOptimise. This is the pattern a full node-declaration migration would follow.
  "optimise-rect": buildToolDefFromDeclaration(optimise_rect_node_default),
  // Data-declared (see ./declarations/split.node.json) — behaviour stays in code. NOTE: outputCount matches
  // the baked-handleCount path exactly; the pre-bake ratio-mode estimate is approximated (parseSplitRatios).
  split: buildToolDefFromDeclaration(split_node_default),
  // Data-declared (see ./declarations/skeleton.node.json) — behaviour stays in code.
  skeleton: buildToolDefFromDeclaration(skeleton_node_default),
  "place-object": {
    type: "place-object",
    label: "Place Object",
    color: "#db2777",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Place Object Along Boundary block. The node holds an ARRAY of objects (params.objects)
    // so one node can lay out many at once; placement honours corner end-strips + pairwise non-overlap
    // (shared computePerimeterPlacement). Each object's length runs along the boundary edge; breadth +
    // setback push into the space from the wall. The `fields` below are the PER-OBJECT editor template —
    // the renderers special-case this node to repeat them per object row rather than reading flat params.
    // `boundary` is the LIST-DRIVEN input (see LIST_INPUT_PARAM in evaluateFlow): wire an N×2 point matrix
    // — metres, local to the flow anchor — and the node solves against THAT outline with no canvas Space
    // wired in, exactly as Inset's `polygon` / Skeleton's `vertices` do. That is what lets a computed room
    // (a Math Engine rectangle) host objects without first materialising it as a Space.
    valueInputs: [{ key: "boundary", label: "Boundary (JSON)" }],
    defaultParams: { objects: [{ ...PLACE_OBJECT_DEFAULT_ENTRY }], seed: 1, boundary: "" },
    fields: [
      { key: "kind", label: "Type", kind: "select", options: PLACE_OBJECT_KIND_OPTIONS },
      { key: "length", label: "Length", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "breadth", label: "Breadth", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "position", label: "Position", kind: "range", min: 0, max: 100, step: 0.5, unit: "%" },
      { key: "setback", label: "Setback", kind: "range", min: 0, max: 5, step: 0.05, unit: "m" },
      { key: "height", label: "Height", kind: "range", min: 0.05, max: 3, step: 0.05, unit: "m" },
      { key: "clearance", label: "Clearance", kind: "range", min: 0, max: 3, step: 0.05, unit: "m" }
    ],
    hint: "Place one or more objects along the input space's boundary \u2014 pick a parametric library object (size auto-measured) or a custom box."
  },
  // Data-declared (see ./declarations/bsp.node.json) — behaviour stays in code (adjacency matrix editor).
  bsp: buildToolDefFromDeclaration(bsp_node_default),
  // Data-declared (see ./declarations/corridoor.node.json) — behaviour stays in code (evalCorridoor +
  // the applyRecipeJson "corridoor" commit runner). Re-registered after the FLOW_TOOLS literals were lost.
  corridoor: buildToolDefFromDeclaration(corridoor_node_default),
  // Data-declared (see ./declarations/core-racking.node.json) — behaviour stays in code (evalCoreRacking).
  "core-racking": buildToolDefFromDeclaration(core_racking_node_default),
  // Data-declared (see ./declarations/agent.node.json). Geometry passes straight through in evaluateFlow;
  // the model call lives in the host's onRunAgent action (never in eval), which bakes its answer into the
  // DOWNSTREAM nodes' params and into this node's own `props` (→ one val-<key> output per suggestion).
  agent: buildToolDefFromDeclaration(agent_node_default),
  // Data-declared (see ./declarations/voronoi.node.json) — behaviour stays in code.
  voronoi: buildToolDefFromDeclaration(voronoi_node_default),
  conditional: {
    type: "conditional",
    label: "Conditional",
    color: "#b45309",
    // Pure value comparator: takes two numbers on its value inputs (A, B), tests A <op> B, and outputs the
    // boolean verdict on `val-result` (1 = True, 0 = False). No geometry input or output.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "a", label: "Value (A)" }, { key: "value", label: "Compare (B)" }],
    valueOutputs: [{ key: "result", label: "True / False" }],
    defaultParams: { op: "gt", value: 30, a: 0 },
    fields: [
      { key: "a", label: "Value (A)", kind: "number", step: 0.5 },
      { key: "op", label: "Condition", kind: "select", options: CONDITION_OP_OPTIONS },
      { key: "value", label: "Compare (B)", kind: "number", step: 0.5 }
    ],
    hint: "Compare two values: A <op> B \u2192 True / False. Wire numbers into A and B; outputs the boolean."
  },
  "param-manip": {
    type: "param-manip",
    label: "Parameter Manipulator",
    color: "#7c3aed",
    // Feedback controller: drives a target node's numeric value-input (wire Value → a node's param) and
    // steps that value each iteration — Increase (+Δ) / Decrease (−Δ) / Random (seeded) — until the wired
    // Conditional's test is met (wire the Conditional's Met output → Signal). The evaluator detects the
    // Manipulator→target→Conditional→Manipulator cycle and iterates it (bounded), so the target settles on
    // the value that satisfies the condition.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "signal", label: "Signal" }],
    valueOutputs: [{ key: "result", label: "Value" }],
    // Sweeps the driven value from Start toward End by Delta — Increment (up) or Decrement (down) — and
    // settles on the first value whose result meets the wired Conditional's test.
    defaultParams: { mode: "increment", delta: 0.5, start: 0, end: 20, value: 1 },
    fields: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "increment", label: "Increment (+\u0394)" },
          { value: "decrement", label: "Decrement (\u2212\u0394)" },
          { value: "exact", label: "Exact Value" }
        ]
      },
      // Exact Value: drive the target with this fixed value (no sweep / condition).
      { key: "value", label: "Value", kind: "number", step: 0.1, showIf: (p) => p.mode === "exact" },
      { key: "delta", label: "Delta", kind: "number", step: 0.1, showIf: (p) => p.mode !== "exact" },
      { key: "start", label: "Start", kind: "number", step: 0.1, showIf: (p) => p.mode !== "exact" },
      { key: "end", label: "End", kind: "number", step: 0.1, showIf: (p) => p.mode !== "exact" }
    ],
    hint: "Feedback controller \u2014 drives a node's value-input, sweeping it from Start to End by Delta (Increment / Decrement) until a wired Conditional's test is met. Wire Value \u2192 a node's param, and a Conditional's Met \u2192 Signal."
  },
  // Data-declared (see ./declarations/bounding-shape.node.json) — behaviour stays in code.
  "bounding-shape": buildToolDefFromDeclaration(bounding_shape_node_default),
  // Data-declared (see ./declarations/convex-hull.node.json) — behaviour stays in code.
  "convex-hull": buildToolDefFromDeclaration(convex_hull_node_default),
  // Data-declared (see ./declarations/convex-decomp.node.json) — behaviour stays in code.
  "convex-decomp": buildToolDefFromDeclaration(convex_decomp_node_default),
  // Data-declared (see ./declarations/mesh.node.json) — behaviour stays in code.
  mesh: buildToolDefFromDeclaration(mesh_node_default),
  // Data-declared (see ./declarations/circle-packing.node.json) — behaviour stays in code.
  "circle-packing": buildToolDefFromDeclaration(circle_packing_node_default),
  // Data-declared (see ./declarations/treemap.node.json) — behaviour stays in code.
  treemap: buildToolDefFromDeclaration(treemap_node_default),
  // Data-declared (see ./declarations/rect-pack.node.json) — behaviour stays in code.
  "rect-pack": buildToolDefFromDeclaration(rect_pack_node_default),
  // Data-declared (see ./declarations/point.node.json) — behaviour stays in code.
  point: buildToolDefFromDeclaration(point_node_default),
  // Data-declared (see ./declarations/vertices.node.json) — a pure VALUE node: vertex list in, same list
  // out, nothing drawn. Polygon is the node that DRAWS a list; this one only carries it.
  vertices: buildToolDefFromDeclaration(vertices_node_default),
  // Data-declared (see ./declarations/network.node.json) — DRAWS a graph JSON as canvas segments
  // (the inverse of Graph Geometry). Behaviour stays in code (evaluateFlow).
  network: buildToolDefFromDeclaration(network_node_default),
  // Data-declared (see ./declarations/rectangle.node.json) — behaviour stays in code.
  rectangle: buildToolDefFromDeclaration(rectangle_node_default),
  // Data-declared (see ./declarations/arc.node.json) — an OPEN arc polyline (centre / radius / start / end
  // angles), evaluated in evaluateFlow. Deliberately NOT IR-safe: a flow using it takes the evaluateFlow
  // path, where rectangles honour their `rotation` and this arc renders (the IR does neither).
  arc: buildToolDefFromDeclaration(arc_node_default),
  polygon: buildToolDefFromDeclaration(polygon_node_default),
  polyline: buildToolDefFromDeclaration(polyline_node_default),
  // Data-declared (see ./declarations/circle.node.json) — behaviour stays in code.
  circle: buildToolDefFromDeclaration(circle_node_default),
  // Batch-A 2D primitives (declarations + evaluateFlow cases): a wireable 2-point Line (open stroke),
  // regular N-gon, Ellipse, Rounded Rectangle and a FILLED Sector (the arc node stays an open stroke).
  line: buildToolDefFromDeclaration(line_node_default),
  ngon: buildToolDefFromDeclaration(ngon_node_default),
  ellipse: buildToolDefFromDeclaration(ellipse_node_default),
  "rounded-rect": buildToolDefFromDeclaration(rounded_rect_node_default),
  sector: buildToolDefFromDeclaration(sector_node_default),
  // Data-declared (see ./declarations/visibility.node.json) — behaviour stays in code.
  visibility: buildToolDefFromDeclaration(visibility_node_default),
  // Data-declared (see ./declarations/smoothing.node.json) — behaviour stays in code (evalSmoothing).
  smoothing: buildToolDefFromDeclaration(smoothing_node_default),
  // Data-declared (see ./declarations/contour.node.json) — behaviour stays in code.
  contour: buildToolDefFromDeclaration(contour_node_default),
  "floor-massing": {
    type: "floor-massing",
    label: "Massing",
    color: "#475569",
    hasInput: true,
    hasOutput: true,
    // Tags the input space with a massing type + floor count (no geometry change). Upward → Footprint
    // Area (extrudes up); Downward → Basement Area (extrudes down). `n` is the floor count, and can be
    // driven by a wired-in value (e.g. a computed floor count) via the `n` value input.
    // Multi-space: tags EVERY connected space and passes each through — one output handle per input
    // space (host bakes the live count into `inputCount`). "single" → one bundle handle for all spaces.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.inputCount) || 1))),
    valueInputs: [{ key: "n", label: "Floors" }],
    // Floor count exposed as a scalar output (right) so it can feed Output Metrics / Math, etc. Mirrors
    // the resolved `n` (a wired-in value overrides the slider).
    valueOutputs: [{ key: "floors", label: "Floors", alignField: "n" }],
    defaultParams: { direction: "upward", n: 1, random: false, seed: 1, outputMode: "perCell", taper: "none", tierFloors: 4, setbackM: 2, tierAreaRatio: 0.85 },
    fields: [
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "upward", label: "Upward (Footprint)" },
          { value: "downward", label: "Downward (Basement)" }
        ]
      },
      // Taper / setback: step the footprint inward every `tierFloors` floors so the tower steps back as
      // it rises. Each tier is derived from the one below (always contained, area non-increasing).
      {
        key: "taper",
        label: "Taper",
        kind: "select",
        options: [
          { value: "none", label: "None (prism)" },
          { value: "setback", label: "Setback (m per tier)" },
          { value: "area-ratio", label: "Area ratio per tier" }
        ]
      },
      { key: "tierFloors", label: "Floors per tier", kind: "range", min: 1, max: 20, step: 1, showIf: (p) => p.taper !== "none" },
      { key: "setbackM", label: "Setback / tier", kind: "range", min: 0, max: 20, step: 0.1, unit: "m", showIf: (p) => p.taper === "setback" },
      { key: "tierAreaRatio", label: "Area ratio / tier", kind: "range", min: 0.1, max: 0.99, step: 0.01, showIf: (p) => p.taper === "area-ratio" },
      // Random floors: auto-pick a stable random floor count in [1, 30] per space (re-roll bumps seed).
      { key: "random", label: "Random floors (1\u201330)", kind: "checkbox" },
      { key: "seed", label: "Seed", kind: "number", min: 1, step: 1, showIf: (p) => Boolean(p.random) },
      // Manual floor count — hidden when Random is on (the count is auto-generated).
      { key: "n", label: "Floors (n)", kind: "range", min: 1, max: 50, step: 1, showIf: (p) => !p.random },
      // One handle per input space, or a single bundle handle. Only meaningful with several input spaces.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per space (one each)" },
          { value: "single", label: "Single (all spaces)" }
        ],
        showIf: (p) => Math.round(Number(p.inputCount) || 1) > 1
      }
    ],
    hint: "Set the space as Footprint (up) / Basement (down) Area with n floors."
  },
  // Data-declared (see ./declarations/graph-source.node.json) — behaviour stays in code.
  "graph-source": buildToolDefFromDeclaration(graph_source_node_default),
  // Data-declared (see ./declarations/segment-source.node.json) — behaviour stays in code.
  "segment-source": buildToolDefFromDeclaration(segment_source_node_default),
  // Data-declared (see ./declarations/node-source.node.json) — behaviour stays in code.
  "node-source": buildToolDefFromDeclaration(node_source_node_default),
  // Data-declared (see ./declarations/node-geometry.node.json) — reads a Node's canvas point and publishes
  // its x / y as value outputs (evaluated in evaluateFlow); wire into a Point to place geometry at the node.
  "node-geometry": buildToolDefFromDeclaration(node_geometry_node_default),
  // Data-declared (see ./declarations/segment-geometry.node.json) — reads a Segment's midpoint / angle /
  // length and publishes them as value outputs (evaluated in evaluateFlow); wire X / Y into a Point.
  "segment-geometry": buildToolDefFromDeclaration(segment_geometry_node_default),
  // Data-declared (see ./declarations/canvas-source.node.json) — behaviour stays in code.
  "canvas-source": buildToolDefFromDeclaration(canvas_source_node_default),
  // Data-declared (see ./declarations/freehand-source.node.json) — behaviour stays in code (graph-source machinery).
  "freehand-source": buildToolDefFromDeclaration(freehand_source_node_default),
  // Data-declared (see ./declarations/freehand-geometry.node.json) — behaviour stays in code (polylines → graph JSON).
  "freehand-geometry": buildToolDefFromDeclaration(freehand_geometry_node_default),
  // Data-declared (see ./declarations/separate.node.json) — behaviour stays in code.
  separate: buildToolDefFromDeclaration(separate_node_default),
  // Data-declared (see ./declarations/filter-by-type.node.json) — behaviour stays in code (reads the
  // attached object's params out of canvasContent.spaceMeta and splits the bundle in two).
  "filter-by-type": buildToolDefFromDeclaration(filter_by_type_node_default),
  // Data-declared (see ./declarations/set-object-param.node.json) — behaviour stays in code (computes the
  // writes in evaluateFlow; the host applies them on Apply, as one undoable history step).
  "set-object-param": buildToolDefFromDeclaration(set_object_param_node_default),
  // Data-declared (see ./declarations/get-object-param.node.json) — behaviour stays in code (reads the
  // attached object params out of canvasContent.spaceMeta into a matrix).
  "get-object-param": buildToolDefFromDeclaration(get_object_param_node_default),
  // Data-declared (see ./declarations/segment-split.node.json) — behaviour stays in code. NOTE: the
  // declaration's outputCount matches the baked-handleCount path exactly; the pre-bake ratio-mode estimate
  // is approximated (falls to 2) since it needs parseSplitRatios — the live count bakes on evaluation.
  "segment-split": buildToolDefFromDeclaration(segment_split_node_default),
  buffer: {
    type: "buffer",
    label: "Buffer",
    color: "#0d9488",
    // Segment node: thickens an incoming graph/segment (polylines) into a Space by buffering every
    // segment by `radius` metres (Minkowski sum with a disk — round caps + round joins) and unioning the
    // result into a single closed polygon. Output = a Space (≥3 pts), so it feeds the Space pipeline.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "radius", label: "Radius" }],
    defaultParams: { radius: 0.5, capStyle: "capsule" },
    fields: [
      { key: "radius", label: "Radius", kind: "range", min: 0.05, max: 10, step: 0.05, unit: "m" },
      // Cap style at the segment ends: Capsule = round caps; Square = flat caps extended by the radius
      // (sharp rectangular ends); Flat = butt caps flush at the segment endpoints (no extension).
      {
        key: "capStyle",
        label: "Style",
        kind: "select",
        options: [
          { value: "capsule", label: "Capsule (round)" },
          { value: "square", label: "Square (extended)" },
          { value: "flat", label: "Flat (butt)" }
        ]
      }
    ],
    hint: "Buffer a segment/graph by a radius \u2192 a Space. Style: Capsule (round caps), Square (extended flat caps), or Flat (butt caps). Feeds the Space pipeline."
  },
  // Data-declared (see ./declarations/bloom.node.json) — behaviour stays in code.
  bloom: buildToolDefFromDeclaration(bloom_node_default),
  // Data-declared (see ./declarations/pull.node.json) — behaviour stays in code.
  pull: buildToolDefFromDeclaration(pull_node_default),
  // Data-declared (see ./declarations/transform.node.json) — behaviour stays in code.
  transform: buildToolDefFromDeclaration(transform_node_default),
  // Data-declared (see ./declarations/mitered-join.node.json) — behaviour stays in code.
  "mitered-join": buildToolDefFromDeclaration(mitered_join_node_default),
  // Data-declared (see ./declarations/graph-to-path.node.json) — behaviour stays in code.
  "graph-to-path": buildToolDefFromDeclaration(graph_to_path_node_default),
  // Data-declared (see ./declarations/graph-smooth.node.json) — behaviour stays in code.
  "graph-smooth": buildToolDefFromDeclaration(graph_smooth_node_default),
  // Data-declared (see ./declarations/graph-metrics.node.json) — behaviour stays in code.
  "graph-metrics": buildToolDefFromDeclaration(graph_metrics_node_default),
  // Data-declared (see ./declarations/graph-geometry.node.json) — publishes the graph STRUCTURE (node ids +
  // from/to/thickness edges) as JSON on val-graph. Behaviour stays in code (evaluateFlow).
  "graph-geometry": buildToolDefFromDeclaration(graph_geometry_node_default),
  // Data-declared (see ./declarations/show-direction.node.json) — behaviour stays in code.
  "show-direction": buildToolDefFromDeclaration(show_direction_node_default),
  // Data-declared (see ./declarations/dimension.node.json) — behaviour stays in code.
  dimension: buildToolDefFromDeclaration(dimension_node_default),
  "graph-to-grid": {
    type: "graph-to-grid",
    label: "Graph to Grid",
    color: "#7c3aed",
    // Grid generator: lays an m × n lattice over the input graph's (or space's) bounding box and emits it
    // as a graph (segments) that chains downstream. The grid's nodes are drawn at "Node size" px and its
    // segments stroked at "Segment width" px (the two values given to nodes vs segments).
    hasInput: true,
    hasOutput: true,
    valueInputs: [
      { key: "m", label: "Columns" },
      { key: "n", label: "Rows" },
      { key: "nodeValue", label: "Node size" },
      { key: "segmentValue", label: "Segment width" }
    ],
    defaultParams: {
      m: 4,
      n: 3,
      nodeValue: 3,
      segmentValue: 1,
      colorCells: false,
      nodeCellValue: 1,
      segmentCellValue: 0.5,
      nodeCellColor: "#ef4444",
      segmentCellColor: "#3b82f6",
      showCellValues: false
    },
    fields: [
      { key: "m", label: "Columns (m)", kind: "range", min: 1, max: 60, step: 1 },
      { key: "n", label: "Rows (n)", kind: "range", min: 1, max: 60, step: 1 },
      // The value given to grid NODES (intersection dot size, px) and to grid SEGMENTS (line width, px).
      { key: "nodeValue", label: "Node size (px)", kind: "range", min: 0, max: 12, step: 0.5 },
      { key: "segmentValue", label: "Segment width (px)", kind: "range", min: 0.5, max: 8, step: 0.5 },
      // Cell occupancy colouring: classify each cell by what falls in it — a graph NODE (vertex) or a
      // graph SEGMENT passing through — and fill it with the matching value/colour.
      { key: "colorCells", label: "Colour cells", kind: "checkbox" },
      { key: "nodeCellValue", label: "Node-cell value", kind: "number", showIf: (p) => p.colorCells === true },
      { key: "nodeCellColor", label: "Node-cell colour", kind: "color", showIf: (p) => p.colorCells === true },
      { key: "segmentCellValue", label: "Segment-cell value", kind: "number", showIf: (p) => p.colorCells === true },
      { key: "segmentCellColor", label: "Segment-cell colour", kind: "color", showIf: (p) => p.colorCells === true },
      { key: "showCellValues", label: "Show cell values", kind: "checkbox", showIf: (p) => p.colorCells === true }
    ],
    hint: "Convert a graph/space into an m \xD7 n grid over its bounding box. Nodes drawn at Node size, segments at Segment width. Colour cells classifies each cell by node/segment occupancy with its own value+colour. Emits the grid as a graph to chain on."
  },
  "grid-distance": {
    type: "grid-distance",
    label: "Grid Distance",
    color: "#9333ea",
    // Grid-field node: recolours an incoming grid (from Graph to Grid) by each cell's distance to the
    // nearest occupied cell — a heatmap. Consumes the grid-field; passes the distance field on.
    hasInput: true,
    hasOutput: true,
    defaultParams: { from: "any", metric: "manhattan", normalize: true, lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "from",
        label: "Distance from",
        kind: "select",
        options: [
          { value: "any", label: "Any occupied" },
          { value: "node", label: "Node cells" },
          { value: "segment", label: "Segment cells" }
        ]
      },
      {
        key: "metric",
        label: "Metric",
        kind: "select",
        options: [
          { value: "manhattan", label: "Manhattan (4-nbr)" },
          { value: "chebyshev", label: "Chebyshev (8-nbr)" },
          { value: "euclidean", label: "Euclidean" }
        ]
      },
      { key: "normalize", label: "Normalize", kind: "checkbox" },
      { key: "lowColor", label: "Near colour", kind: "color" },
      { key: "highColor", label: "Far colour", kind: "color" },
      { key: "showCellValues", label: "Show values", kind: "checkbox" }
    ],
    hint: "Heatmap each grid cell by its distance to the nearest occupied (node/segment) cell \u2014 Manhattan / Chebyshev / Euclidean, coloured Near\u2192Far. Feed it from Graph to Grid."
  },
  "grid-field": {
    type: "grid-field",
    label: "Grid Field",
    color: "#9333ea",
    // Grid-field node: generate a synthetic elevation field over an incoming lattice — a directional ramp
    // (top→bottom, etc.) between High and Low + per-cell random jitter, optionally incising occupied
    // (river) cells lower. Publishes the DEM (values + elev) for Fill Depressions.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "high", label: "High" }, { key: "low", label: "Low" }],
    defaultParams: { direction: "top-bottom", high: 100, low: 0, randomness: 0.2, seed: 1, inciseOccupied: false, inciseDepth: 20, lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "direction",
        label: "Ramp direction",
        kind: "select",
        options: [
          { value: "top-bottom", label: "Top \u2192 Bottom" },
          { value: "bottom-top", label: "Bottom \u2192 Top" },
          { value: "left-right", label: "Left \u2192 Right" },
          { value: "right-left", label: "Right \u2192 Left" },
          { value: "radial", label: "Radial (centre high)" }
        ]
      },
      { key: "high", label: "High value", kind: "number" },
      { key: "low", label: "Low value", kind: "number" },
      { key: "randomness", label: "Randomness", kind: "range", min: 0, max: 1, step: 0.05 },
      { key: "seed", label: "Seed", kind: "number" },
      { key: "inciseOccupied", label: "Incise occupied (rivers)", kind: "checkbox" },
      { key: "inciseDepth", label: "Incise depth", kind: "number", showIf: (p) => p.inciseOccupied === true },
      { key: "lowColor", label: "Low colour", kind: "color" },
      { key: "highColor", label: "High colour", kind: "color" },
      { key: "showCellValues", label: "Show values", kind: "checkbox" }
    ],
    hint: "Generate a synthetic elevation field over an incoming lattice \u2014 a directional ramp (High\u2192Low) plus random jitter, optionally incising occupied (river) cells lower. Feed from Graph to Grid; chain into Fill Depressions for the watershed pipeline."
  },
  "laplace-solver": {
    type: "laplace-solver",
    label: "Laplace Solver",
    color: "#9333ea",
    // Grid-field node: solve ∇²φ = 0 by iterative relaxation → a smooth harmonic potential field. Dirichlet
    // boundaries from the grid edges and/or occupied cells; free cells relax to the neighbour average.
    // Feed φ into Marching Squares for equipotentials / flow nets.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "highValue", label: "High" }, { key: "lowValue", label: "Low" }],
    defaultParams: { method: "sor", iterations: 300, tolerance: 1e-3, omega: 1.8, pinEdges: "top-bottom", pinOccupied: false, highValue: 1, lowValue: 0, lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "method",
        label: "Solver",
        kind: "select",
        options: [
          { value: "sor", label: "SOR (fastest)" },
          { value: "gauss-seidel", label: "Gauss-Seidel" },
          { value: "jacobi", label: "Jacobi" }
        ]
      },
      { key: "iterations", label: "Max iterations", kind: "range", min: 10, max: 2e3, step: 10 },
      { key: "tolerance", label: "Tolerance", kind: "number" },
      { key: "omega", label: "Over-relaxation (\u03C9)", kind: "range", min: 1, max: 1.99, step: 0.01, showIf: (p) => p.method === "sor" },
      {
        key: "pinEdges",
        label: "Pin edges",
        kind: "select",
        options: [
          { value: "top-bottom", label: "Top \u2192 Bottom" },
          { value: "left-right", label: "Left \u2192 Right" },
          { value: "all", label: "All borders (low)" },
          { value: "none", label: "None" }
        ]
      },
      { key: "pinOccupied", label: "Pin occupied (sources)", kind: "checkbox" },
      { key: "highValue", label: "High potential", kind: "number" },
      { key: "lowValue", label: "Low potential", kind: "number" },
      { key: "lowColor", label: "Low colour", kind: "color" },
      { key: "highColor", label: "High colour", kind: "color" },
      { key: "showCellValues", label: "Show values", kind: "checkbox" }
    ],
    hint: "Solve Laplace's equation \u2207\xB2\u03C6 = 0 over the grid (Jacobi / Gauss-Seidel / SOR relaxation) \u2192 a smooth harmonic potential. Pin boundaries from the edges (top\u2192bottom battery) and/or occupied cells. Feed \u03C6 into Marching Squares for equipotentials / streamlines."
  },
  "fill-depressions": {
    type: "fill-depressions",
    label: "Fill Depressions",
    color: "#9333ea",
    // Pure MATRIX value node: a DEM MATRIX in (valin-matrix — the wired matrix shows in the Matrix box) with
    // wireable Min slope (ε) / Edges-drain params, the hydrologically-conditioned (filled) DEM MATRIX out
    // (val-matrix, bottom-right). No geometry endpoints. Draws nothing — wire Render Grid to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }, { key: "epsilon", label: "Min slope (\u03B5)" }, { key: "edgesAreOutlets", label: "Edges drain off" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", epsilon: 0, edgesAreOutlets: true },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "epsilon", label: "Min slope (\u03B5)", kind: "number" },
      { key: "edgesAreOutlets", label: "Edges drain off-grid", kind: "checkbox" }
    ],
    hint: "Fill sinks/pits in a DEM grid-field (Priority-Flood) so every cell drains to the border. Set Min slope (\u03B5) > 0 to also resolve flats (Priority-Flood+\u03B5). Feed from Grid / Graph to Grid; chain into Flow Direction."
  },
  "flow-direction": {
    type: "flow-direction",
    label: "Flow Direction",
    color: "#9333ea",
    // Pure MATRIX value node: a DEM MATRIX in (valin-matrix, next to the Matrix box — the wired matrix appears
    // there) and a wireable Method, the D8 direction-code MATRIX out (val-matrix, bottom-right). No geometry
    // endpoints. Draws nothing — wire Render Grid (arrows) to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }, { key: "method", label: "Method" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", method: "d8" },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      {
        key: "method",
        label: "Method",
        kind: "select",
        options: [
          { value: "d8", label: "D8 (steepest)" },
          { value: "rho8", label: "Rho8 (stochastic)" }
        ]
      }
    ],
    hint: "D8 flow direction as a VALUE node \u2014 a DEM matrix in (wire val-matrix into valin-matrix, or a grid-field), the direction-code matrix (0..7, -1 = sink) out on val-matrix. Wire Render Grid (arrows) to see it. Rho8 randomises among downslope neighbours."
  },
  "flow-accumulation": {
    type: "flow-accumulation",
    label: "Flow Accumulation",
    color: "#9333ea",
    // Pure MATRIX value node: a flow-direction MATRIX in (valin-matrix — the wired matrix shows in the Matrix
    // box), the accumulation-count MATRIX out (val-matrix, bottom-right). No geometry endpoints. Draws nothing
    // — wire Render Grid to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", asArea: false },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "asArea", label: "Contributing area (m\xB2)", kind: "checkbox" }
    ],
    hint: "Flow accumulation as a VALUE node \u2014 a flow-direction matrix / grid-field in, the accumulation-count matrix out on val-matrix. Feed from Flow Direction; wire Render Grid to see the channels."
  },
  "watershed": {
    type: "watershed",
    label: "Watershed",
    color: "#9333ea",
    // Pure MATRIX value node: a flow-direction MATRIX in (valin-matrix — the wired matrix shows in the Matrix
    // box) + a wireable Outlet, the basin-mask MATRIX out (val-matrix, bottom-right). No geometry endpoints.
    // Outlet = "col,row" cell index (blank = lowest cell). Draws nothing — wire Render Grid to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }, { key: "outlet", label: "Outlet" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", outlet: "" },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "outlet", label: "Outlet (col,row)", kind: "text", placeholder: "blank = lowest cell" }
    ],
    hint: "Watershed as a MATRIX value node \u2014 a flow-direction matrix in, the basin-mask matrix out on val-matrix. Outlet = 'col,row' cell index (blank = lowest cell). Wire Render Grid (categorical) to see the basin."
  },
  "morphology": {
    type: "morphology",
    label: "Morphology",
    color: "#9333ea",
    // Grid-field node: morphological erosion / dilation and their compositions over a binary mask
    // (threshold the input) or grayscale field (min/max filters). Structuring element = cross / square /
    // disk of the given radius; iterations repeat the primitive. Passes the processed field on.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "radius", label: "Radius" }, { key: "iterations", label: "Iterations" }],
    defaultParams: { operation: "erode", shape: "cross", radius: 1, iterations: 1, grayscale: false, threshold: 0.5, clampEdges: true, showBackground: false, fgColor: "#22c55e", bgColor: "#475569", lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "operation",
        label: "Operation",
        kind: "select",
        options: [
          { value: "erode", label: "Erode (shrink)" },
          { value: "dilate", label: "Dilate (grow)" },
          { value: "open", label: "Open (erode\u2192dilate)" },
          { value: "close", label: "Close (dilate\u2192erode)" },
          { value: "gradient", label: "Gradient (edges)" },
          { value: "tophat", label: "Top-hat" },
          { value: "blackhat", label: "Black-hat" },
          { value: "boundary", label: "Boundary" }
        ]
      },
      {
        key: "shape",
        label: "Element",
        kind: "select",
        options: [
          { value: "cross", label: "Cross (4-nbr)" },
          { value: "square", label: "Square (8-nbr)" },
          { value: "disk", label: "Disk (radius)" }
        ]
      },
      { key: "radius", label: "Radius", kind: "range", min: 1, max: 10, step: 1 },
      { key: "iterations", label: "Iterations", kind: "range", min: 1, max: 10, step: 1 },
      { key: "grayscale", label: "Grayscale (min/max)", kind: "checkbox" },
      { key: "threshold", label: "Binarise threshold", kind: "number", showIf: (p) => p.grayscale !== true },
      { key: "clampEdges", label: "Preserve edges", kind: "checkbox" },
      { key: "showBackground", label: "Show background", kind: "checkbox", showIf: (p) => p.grayscale !== true },
      { key: "fgColor", label: "Foreground colour", kind: "color", showIf: (p) => p.grayscale !== true },
      { key: "bgColor", label: "Background colour", kind: "color", showIf: (p) => p.grayscale !== true && p.showBackground === true },
      { key: "lowColor", label: "Low colour", kind: "color", showIf: (p) => p.grayscale === true },
      { key: "highColor", label: "High colour", kind: "color", showIf: (p) => p.grayscale === true },
      { key: "showCellValues", label: "Show values", kind: "checkbox" }
    ],
    hint: "Morphological erosion / dilation and compositions (open, close, gradient, top-hat, black-hat, boundary) over a grid field \u2014 binary (threshold the input) or grayscale (min/max). Feed from Grid Threshold / Watershed / Flow Accumulation; chain into Marching Squares."
  },
  "cellular-automaton": {
    type: "cellular-automaton",
    label: "Cellular Automaton",
    color: "#9333ea",
    // Grid-field node: evolve a binary lattice N generations under a Birth/Survive rule — Conway's Game of
    // Life (B3/S23) and friends (HighLife, Maze, Cave, custom). Seed from the input mask or a random fill.
    // Publishes the final 0/1 state for downstream masking / vectorisation.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "generations", label: "Generations" }],
    defaultParams: { preset: "conway", birth: "3", survive: "23", neighborhood: "moore", boundary: "toroidal", generations: 10, seedSource: "random", threshold: 0.5, density: 0.35, seed: 1, colorByAge: false, aliveColor: "#22c55e", showDead: false, deadColor: "#1e293b", lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "preset",
        label: "Rule (Game of Life)",
        kind: "select",
        options: [
          { value: "conway", label: "Conway B3/S23" },
          { value: "highlife", label: "HighLife B36/S23" },
          { value: "daynight", label: "Day & Night" },
          { value: "seeds", label: "Seeds B2/S" },
          { value: "replicator", label: "Replicator" },
          { value: "maze", label: "Maze B3/S12345" },
          { value: "cave", label: "Cave B678/S345678" },
          { value: "custom", label: "Custom B/S" }
        ]
      },
      { key: "birth", label: "Birth (B)", kind: "text", placeholder: "3", showIf: (p) => p.preset === "custom" },
      { key: "survive", label: "Survive (S)", kind: "text", placeholder: "23", showIf: (p) => p.preset === "custom" },
      {
        key: "neighborhood",
        label: "Neighbourhood",
        kind: "select",
        options: [
          { value: "moore", label: "Moore (8)" },
          { value: "vonneumann", label: "von Neumann (4)" }
        ]
      },
      {
        key: "boundary",
        label: "Boundary",
        kind: "select",
        options: [
          { value: "toroidal", label: "Toroidal (wrap)" },
          { value: "dead", label: "Dead edges" },
          { value: "mirror", label: "Mirror" }
        ]
      },
      { key: "generations", label: "Generations", kind: "range", min: 0, max: 200, step: 1 },
      {
        key: "seedSource",
        label: "Seed from",
        kind: "select",
        options: [
          { value: "random", label: "Random fill" },
          { value: "mask", label: "Input mask" }
        ]
      },
      { key: "density", label: "Fill density", kind: "range", min: 0, max: 1, step: 0.05, showIf: (p) => p.seedSource === "random" },
      { key: "seed", label: "Seed", kind: "number", showIf: (p) => p.seedSource === "random" },
      { key: "threshold", label: "Mask threshold", kind: "number", showIf: (p) => p.seedSource === "mask" },
      { key: "colorByAge", label: "Colour by age", kind: "checkbox" },
      { key: "aliveColor", label: "Alive colour", kind: "color", showIf: (p) => p.colorByAge !== true },
      { key: "lowColor", label: "Young colour", kind: "color", showIf: (p) => p.colorByAge === true },
      { key: "highColor", label: "Old colour", kind: "color", showIf: (p) => p.colorByAge === true },
      { key: "showDead", label: "Show dead cells", kind: "checkbox" },
      { key: "deadColor", label: "Dead colour", kind: "color", showIf: (p) => p.showDead === true },
      { key: "showCellValues", label: "Show values", kind: "checkbox" }
    ],
    hint: "Cellular automaton \u2014 evolve a grid N generations under a Birth/Survive rule (Conway's Game of Life B3/S23, HighLife, Maze, Cave, or custom). Seed from the input mask or a random fill. Moore/von-Neumann neighbours, wrap/dead/mirror edges. Emits the 0/1 state \u2192 Morphology / Marching Squares / Graph to Spaces."
  },
  "grid-source": {
    type: "grid-source",
    label: "Grid",
    color: "#7c3aed",
    // Pipeline input — a construction Grid on the canvas (Create Grid). Like the Space node: references a
    // grid by display id, or tracks the grid currently selected on the canvas. Emits its lattice lines.
    hasInput: false,
    hasOutput: true,
    defaultParams: { id: "", grabFromSelection: true },
    fields: [
      { key: "grabFromSelection", label: "Grab ID from selection", kind: "checkbox" },
      { key: "id", label: "ID", kind: "text", placeholder: "Grid001", showIf: (p) => !p.grabFromSelection }
    ],
    hint: "Pipeline input \u2014 a Grid on the canvas (by id, or the current selection). Emits its lattice lines."
  },
  "grid-threshold": {
    type: "grid-threshold",
    label: "Grid Threshold",
    color: "#9333ea",
    // Pure MATRIX value node: a MATRIX in (valin-matrix — the wired matrix shows in the Matrix box) with a
    // wireable Test / Threshold, a 0/1 MASK MATRIX out (val-matrix, bottom-right). No geometry endpoints.
    // Draws nothing — chain into Marching Squares (streamlines) or Render Grid.
    hasInput: false,
    hasOutput: false,
    // WHERE THE MATRIX IS — and this is the node that decides it for the whole chain. A bare matrix is
    // only numbers; the FIRST node to lift one into a grid field fixes its world frame, and every node
    // downstream inherits that field rather than re-reading the matrix (fieldInputOf follows any incoming
    // edge, value edges included). So placing a contour on the picture it came from means setting Cell
    // size / Origin here, not on Marching Squares, where the same params are silently overridden by the
    // field arriving from this node.
    valueInputs: [
      { key: "matrix", label: "Matrix" },
      { key: "op", label: "Test" },
      { key: "threshold", label: "Threshold" },
      { key: "cellSize", label: "Cell size" },
      { key: "originX", label: "Origin X" },
      { key: "originY", label: "Origin Y" }
    ],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", op: ">", threshold: 0, cellSize: 1, originX: 0, originY: 0 },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      {
        key: "op",
        label: "Test",
        kind: "select",
        options: [
          { value: ">", label: "value > X" },
          { value: ">=", label: "value \u2265 X" },
          { value: "<", label: "value < X" },
          { value: "<=", label: "value \u2264 X" },
          { value: "==", label: "value = X" },
          { value: "!=", label: "value \u2260 X" }
        ]
      },
      { key: "threshold", label: "Threshold (X)", kind: "number" }
    ],
    hint: "Grid Threshold as a MATRIX value node \u2014 a matrix in, a 0/1 mask matrix out (cells where value passes the test). Feed from Flow Accumulation; chain into Marching Squares for streamlines."
  },
  "marching-squares": {
    type: "marching-squares",
    label: "Marching Squares",
    color: "#9333ea",
    // Matrix / grid-field IN → contour LINES out (polylines, a graph). Takes a MATRIX (valin-matrix — e.g. a
    // Grid Threshold mask for streamlines — shown in the Matrix box) or a wired grid-field; keeps its geometry
    // OUTPUT so the contours render / chain into Polygon / Network / Mitered Join.
    hasInput: true,
    hasOutput: true,
    // WHERE THE MATRIX IS. A wired grid-FIELD carries its own world frame; a bare MATRIX does not — it is
    // just numbers — so `gridFieldFromMatrix` places it by Cell size + Origin X/Y. Those three were params
    // only, which meant a contour traced off an IMAGE could not be put back on the picture it was read
    // from: the Image node publishes the underlay's real `val-cellM` / `val-originX` / `val-originY` for
    // exactly that purpose, and there was no endpoint to wire them into. Now there is, so the contour
    // lands registered on the drawing and follows it when the underlay is moved or rescaled.
    valueInputs: [
      { key: "matrix", label: "Matrix" },
      { key: "levels", label: "Levels" },
      { key: "cellSize", label: "Cell size" },
      { key: "originX", label: "Origin X" },
      { key: "originY", label: "Origin Y" }
    ],
    defaultParams: { matrix: "", levels: 5, cellSize: 1, originX: 0, originY: 0 },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "levels", label: "Contour levels", kind: "range", min: 1, max: 12, step: 1 },
      { key: "cellSize", label: "Cell size", kind: "number", unit: "m" },
      { key: "originX", label: "Origin X", kind: "number", unit: "m" },
      { key: "originY", label: "Origin Y", kind: "number", unit: "m" }
    ],
    hint: "Extract iso-contours from a MATRIX / grid field \u2014 N evenly-spaced levels between min and max \u2192 contour lines (a graph). Feed a Grid Threshold mask (val-matrix) for streamlines, or any grid-field. A bare matrix has no world frame: wire an Image node's Cell size / Origin X / Origin Y to land the contour on the picture it was traced from. Levels 1 over a 0/1 mask gives the single boundary of that mask \u2014 the outline of the black region. Chain into Polygon / Network / Graph Geometry \u2192 Graph to Spaces."
  },
  // Data-declared (see ./declarations/area-dimension.node.json) — behaviour stays in code.
  "area-dimension": buildToolDefFromDeclaration(area_dimension_node_default),
  // Data-declared (see ./declarations/graph-to-spaces.node.json) — behaviour stays in code.
  "graph-to-spaces": buildToolDefFromDeclaration(graph_to_spaces_node_default),
  "longest-branch": {
    type: "longest-branch",
    label: "Longest Branch",
    color: "#0e7490",
    // Pure VALUE node: takes a graph as JSON (`valin-graph`) and returns its single longest branch — the
    // path between the two farthest tips (weighted graph diameter) — on `val-graph`. Draws nothing.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "graph", label: "Graph" }],
    valueOutputs: [{ key: "graph", label: "Graph (JSON)" }],
    defaultParams: { graph: "" },
    fields: [{ key: "graph", label: "Graph (JSON)", kind: "text" }],
    hint: "Return the longest branch of the incoming graph (the path between its two farthest tips) as a graph on val-graph."
  },
  // Data-declared (see ./declarations/graph-reduce.node.json) — behaviour stays in code.
  "graph-reduce": buildToolDefFromDeclaration(graph_reduce_node_default),
  "graph-simplify": buildToolDefFromDeclaration(graph_simplify_node_default),
  "graph-clip": buildToolDefFromDeclaration(graph_clip_node_default),
  "graph-fit-lines": buildToolDefFromDeclaration(graph_fit_lines_node_default),
  "graph-classify": buildToolDefFromDeclaration(graph_classify_node_default),
  "grid-geometry": buildToolDefFromDeclaration(grid_geometry_node_default),
  "render-grid": buildToolDefFromDeclaration(render_grid_node_default),
  "matrix-transpose": buildToolDefFromDeclaration(matrix_transpose_node_default),
  "matrix-inverse": buildToolDefFromDeclaration(matrix_inverse_node_default),
  "matrix-solve": buildToolDefFromDeclaration(matrix_solve_node_default),
  "least-squares": buildToolDefFromDeclaration(least_squares_node_default),
  "matrix-ops": buildToolDefFromDeclaration(matrix_ops_node_default),
  "matrix-shift": buildToolDefFromDeclaration(matrix_shift_node_default),
  "vector-ops": buildToolDefFromDeclaration(vector_ops_node_default),
  "vector-product": buildToolDefFromDeclaration(vector_product_node_default),
  "matrix-to-graph": buildToolDefFromDeclaration(matrix_to_graph_node_default),
  "graph-to-matrix": buildToolDefFromDeclaration(graph_to_matrix_node_default),
  "graph-interpreter": buildToolDefFromDeclaration(graph_interpreter_node_default),
  "canvas-encoder": buildToolDefFromDeclaration(canvas_encoder_node_default),
  // 2D / 3D Render — one node per operation's whole drawing output; the ROWS (params.prims) are dynamic,
  // so behaviour lives in code (renderPrims + the per-row editor/handles) exactly like Input Properties.
  "render-2d": buildToolDefFromDeclaration(render_2d_node_default),
  "render-3d": buildToolDefFromDeclaration(render_3d_node_default),
  // Material — a LINK to a Library/Materials file, wired into a 3D Render row's own `matin-<rowId>`
  // endpoint. It holds a path and nothing else: the file is resolved by whoever renders (viewport,
  // glTF, DXF, the Blender addon), so retuning one material restyles every row pointing at it.
  material: buildToolDefFromDeclaration(material_node_default),
  // Export sinks: they draw nothing and commit nothing — the node body's Download button writes the file
  // from what is wired in (2D preview pieces → DXF; 3D primitive descriptors → glTF/OBJ/STL/PLY).
  "export-dxf": buildToolDefFromDeclaration(export_dxf_node_default),
  "export-3d": buildToolDefFromDeclaration(export_3d_node_default),
  // The third sink: same "read what is wired in, produce nothing" shape, but it writes to the PLAN rather
  // than to a file — the wired node's polygons land as ordinary Spaces + segments (see onExportToCanvas).
  "export-canvas": buildToolDefFromDeclaration(export_canvas_node_default),
  "matrix-reduce": buildToolDefFromDeclaration(matrix_reduce_node_default),
  "matrix-eigen": buildToolDefFromDeclaration(matrix_eigen_node_default),
  snapshot: buildToolDefFromDeclaration(snapshot_node_default),
  // Data-declared (see ./declarations/set-thickness.node.json) — behaviour stays in code.
  "set-thickness": buildToolDefFromDeclaration(set_thickness_node_default),
  // Data-declared (see ./declarations/merge-graph.node.json) — behaviour stays in code.
  "merge-graph": buildToolDefFromDeclaration(merge_graph_node_default),
  // Data-declared (see ./declarations/graph-to-openings.node.json) — behaviour stays in code.
  "graph-to-openings": buildToolDefFromDeclaration(graph_to_openings_node_default),
  "label-graph": buildToolDefFromDeclaration(label_graph_node_default),
  "filter-by-label": buildToolDefFromDeclaration(filter_by_label_node_default),
  // Data-declared (see ./declarations/voronoi-bloom.node.json) — behaviour stays in code.
  "voronoi-bloom": buildToolDefFromDeclaration(voronoi_bloom_node_default),
  // Data-declared (see ./declarations/spring-layout.node.json) — behaviour stays in code.
  "spring-layout": buildToolDefFromDeclaration(spring_layout_node_default),
  // Data-declared (see ./declarations/schema.node.json) — behaviour stays in code (custom on-node editor).
  schema: buildToolDefFromDeclaration(schema_node_default),
  // Data-declared (see ./declarations/output-schema.node.json) — behaviour stays in code (custom editor).
  "output-schema": buildToolDefFromDeclaration(output_schema_node_default),
  // Data-declared (see ./declarations/pipe-solver.node.json) — behaviour stays in code (schema-driven solver).
  "pipe-solver": buildToolDefFromDeclaration(pipe_solver_node_default),
  "frame-builder": {
    type: "frame-builder",
    label: "Frame Builder",
    color: "#9a3412",
    // Structural footprint generator (sibling of the Pipe Network Solver). Two inputs: the MAIN
    // (geometry) input takes a Graph node — it then frames only that graph; unconnected, it frames the
    // whole canvas segment graph. The "Schema" input (gin-schema) takes a Schema node whose Node /
    // Segment / Graph sections define the per-component inputs (column width/height, beam width, hatch,
    // and a graph-level "subtract"), shown + editable in each component's Properties tab. Reads them by
    // role: each node → a width×height column box; each segment → a beam ribbon; if the graph's
    // "subtract" is on, beams are cut back to the column faces. Emits the footprints as Spaces; wire its
    // output into an Output Schema node to choose which per-component results show in the Metrics tab.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueOutputs: [
      { key: "columns", label: "Columns" },
      { key: "beams", label: "Beams" },
      { key: "totalBeamLength", label: "Beam length", unit: "m" },
      { key: "totalColumnArea", label: "Column area", unit: "m\xB2" }
    ],
    // Fallbacks used only when the wired Schema doesn't define the matching property (so the node still
    // produces a sensible frame on its own). The schema's per-component values override these.
    defaultParams: { columnWidthMm: 300, columnHeightMm: 450, beamWidthMm: 230, subtract: true },
    fields: [
      { key: "columnWidthMm", label: "Column width", kind: "range", min: 0, max: 2e3, step: 10, unit: "mm" },
      { key: "columnHeightMm", label: "Column height", kind: "range", min: 0, max: 3e3, step: 10, unit: "mm" },
      { key: "beamWidthMm", label: "Beam width", kind: "range", min: 0, max: 1e3, step: 10, unit: "mm" },
      { key: "subtract", label: "Subtract beams from columns", kind: "checkbox" }
    ],
    hint: "Frame a graph: nodes \u2192 column boxes (width\xD7height), segments \u2192 beam ribbons (width); optionally subtract beams from columns. Wire a Schema node for per-component sizing/hatch; wire Output Schema for Metrics."
  },
  "wall-builder": {
    type: "wall-builder",
    label: "Graph to Walls",
    color: "#b45309",
    // Schema-driven mitred walls. Two inputs: the MAIN (geometry) input takes a Graph/Canvas node — it
    // strokes that graph's segments into mitred wall ribbons (junctions mitre cleanly via the canvas
    // mitering engine). The "Schema" input (gin-schema) takes a Schema node whose Segment section defines
    // per-segment Thickness / Justification / Hatch (and a Type discriminator); the wall width is read
    // straight from each segment's schema THICKNESS (role "wall-thickness"), not the canvas thickness.
    // Only "wall"-typed segments are stroked (doors / windows are openings). Emits the wall footprints.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueOutputs: [
      { key: "walls", label: "Walls" },
      { key: "totalLength", label: "Wall length", unit: "m" },
      { key: "totalArea", label: "Wall area", unit: "m\xB2" }
    ],
    // Fallbacks used only when the schema doesn't define the property for a segment.
    defaultParams: { thicknessMm: 230, justification: "center", height: 3, union: true, showOuterDim: false, showInnerDim: false, showCenterDim: false, offsetDim: false, dimGap: 0.18 },
    fields: [
      { key: "thicknessMm", label: "Thickness", kind: "range", min: 0, max: 1e3, step: 10, unit: "mm", role: "wall-thickness" },
      // Justification is which side of the (always-snappable) centerline the SOLID sits on. Inner / Outer
      // are decided from the enclosed room geometry (Inner = room side, Outer = street side) — so they read
      // sensibly while tracing; Center splits T/2 each side and keeps editing cleanest.
      {
        key: "justification",
        label: "Justification",
        kind: "select",
        role: "wall-justification",
        options: [
          { value: "inner", label: "Inner" },
          { value: "center", label: "Center" },
          { value: "outer", label: "Outer" }
        ]
      },
      // Wall height (m) — no plan-view effect; consumed by 3D / elevation. Per-element via role "wall-height".
      { key: "height", label: "Height", kind: "range", min: 0, max: 10, step: 0.05, unit: "m", role: "wall-height" },
      // Union: merge the band fills and stroke only the outer / inner faces — removes the internal
      // mitre-seam diagonals at junctions for a clean architectural drawing.
      { key: "union", label: "Union", kind: "checkbox" },
      // Dimension the wall band's faces. Which face is OUTER vs INNER is decided from the enclosed room
      // geometry (the room-facing face is "inner"), not the draw direction.
      { key: "showOuterDim", label: "Show Outer Dimension", kind: "checkbox" },
      { key: "showInnerDim", label: "Show Inner Dimension", kind: "checkbox" },
      // Center dimension = the wall's centerline (spine) length, drawn on the centerline.
      { key: "showCenterDim", label: "Show Center Dimension", kind: "checkbox" },
      // Offsetted Dimension: report the inner / outer face as the centerline length offset by half the
      // thickness each end (inner = spine − T, outer = spine + T) — the nominal trace dimension — rather
      // than the actual mitred face length. Only affects the inner / outer face values.
      { key: "offsetDim", label: "Offsetted Dimension", kind: "checkbox", showIf: (p) => p.showOuterDim === true || p.showInnerDim === true },
      { key: "dimGap", label: "Dimension Offset", kind: "number", min: 0, max: 2, step: 0.02, unit: "m", showIf: (p) => p.showOuterDim === true || p.showInnerDim === true }
    ],
    hint: "Stroke a graph into mitred walls, taking each wall's thickness from the Segment schema (role wall-thickness). The wall solid follows Justification (default center); the centerline is always what you snap to. Show Inner / Outer Dimension dimension the room-facing and street-facing faces \u2014 inner vs outer is decided from the enclosed room geometry; Show Center Dimension dimensions the centerline. Wire a Schema node into the Schema input; only wall-typed segments are drawn."
  },
  "graph-to-room": {
    type: "graph-to-room",
    label: "Graph to Room",
    color: "#16a34a",
    // Forms the INNER (clear) rooms from the wall graph: each wall-bounded face is inset to the inner wall
    // faces by half each bounding wall's schema thickness. Present-only gate — the canvas auto-room detector
    // does the inset when this node exists, so the rooms stay selectable Spaces with the schema's Space
    // properties injected. Emits the resulting room polygons + count / area for downstream consumers.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueOutputs: [
      { key: "rooms", label: "Rooms" },
      { key: "totalArea", label: "Room area", unit: "m\xB2" }
    ],
    defaultParams: {},
    fields: [],
    hint: "Forms inner (clear) rooms from the wall graph \u2014 each wall-bounded face is inset by half its schema thickness to the inner wall faces. The rooms stay selectable Spaces carrying the Schema's Space properties. Wire the Canvas Graph (out-3) in; attach a Schema for per-wall thickness."
  },
  "segment-to-door": {
    type: "segment-to-door",
    label: "Segment to Door",
    color: "#9333ea",
    // Draws a door symbol on each input segment (the door opening). Shape:
    //  • polygon  — fills the opening as a rectangle of the given Thickness (a solid leaf block);
    //  • arc      — a simple swing arc plus two lines (the open leaf + the closed position);
    //  • detailed — the leaf drawn as a thin panel plus the swing arc, placed by Hinge (left/right end)
    //               and Swing (which side of the wall it opens).
    // Schema-driven: wire a Schema node into "gin-schema" (or attach one to the canvas/graph) and each
    // segment's shape / hinge / swing / thickness come from its own schema values by role (door-shape /
    // door-hinge / door-placement / door-thickness); only "door"-typed segments are drawn. The params
    // below are the fallback when no schema value is set.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    // Wireable so an Input Properties brief can drive the door (a wired value overrides the node param).
    valueInputs: [{ key: "shape", label: "Shape" }, { key: "thickness", label: "Thickness" }, { key: "hinge", label: "Hinge" }, { key: "swing", label: "Swing" }],
    defaultParams: { shape: "arc", thickness: 0.05, hinge: "left", swing: "left", lintelHeight: 2.1, color: "#9333ea" },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        role: "door-shape",
        options: [
          { value: "polygon", label: "Polygon (filled)" },
          { value: "arc", label: "Arc + lines" },
          { value: "detailed", label: "Detailed (leaf + swing)" }
        ]
      },
      // Leaf / fill thickness (m): the polygon block depth, or the detailed leaf panel thickness.
      { key: "thickness", label: "Thickness", kind: "range", min: 0.01, max: 0.5, step: 0.01, unit: "m", role: "door-thickness", showIf: (p) => p.shape === "polygon" || p.shape === "detailed" },
      // Hinge end + swing side — the door's main-line parameters (arc / detailed only).
      {
        key: "hinge",
        label: "Hinge",
        kind: "select",
        role: "door-hinge",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" }
        ],
        showIf: (p) => p.shape !== "polygon"
      },
      {
        key: "swing",
        label: "Swing",
        kind: "select",
        role: "door-placement",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" }
        ],
        showIf: (p) => p.shape !== "polygon"
      },
      // Door opening height (3D) — moved here from the native segment Properties so a door's lintel lives
      // with the rest of its parameters. Per-element via role "lintel-height".
      { key: "lintelHeight", label: "Lintel height", kind: "range", min: 0, max: 5, step: 0.05, unit: "m", role: "lintel-height" },
      // Symbol colour (fill + stroke). Per-element via role "door-color"; node param is the fallback.
      { key: "color", label: "Color", kind: "color", role: "door-color" }
    ],
    hint: "Draw a door on each input segment \u2014 polygon (filled), arc + two lines, or detailed (leaf + swing with hinge/swing side)."
  },
  "segment-to-window": {
    type: "segment-to-window",
    label: "Segment to Window",
    color: "#0891b2",
    // Draws a window symbol on each input segment (the window opening). Shape:
    //  • polygon  — fills the opening as a rectangle of the given Thickness (a solid frame block);
    //  • lines    — the classic window: the two frame edges + a centre glass line + jamb caps;
    //  • detailed — a frame rectangle + centre glass line + (Panes − 1) mullion dividers.
    // Schema-driven: wire a Schema into "gin-schema" (or attach one to the canvas/graph) and each segment's
    // shape / thickness / panes come from its own schema values by role (window-shape / window-thickness /
    // window-panes); only "window"-typed segments are drawn. The params below are the fallback.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { shape: "lines", thickness: 0.1, panes: 2, sillHeight: 0.9, lintelHeight: 2.1, color: "#0891b2" },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        role: "window-shape",
        options: [
          { value: "polygon", label: "Polygon (filled)" },
          { value: "lines", label: "Lines (frame + glass)" },
          { value: "detailed", label: "Detailed (panes)" }
        ]
      },
      // Frame / wall thickness (m): the opening depth across the wall (drives all three shapes).
      { key: "thickness", label: "Thickness", kind: "range", min: 0.02, max: 0.6, step: 0.01, unit: "m", role: "window-thickness" },
      // Glass divisions — the number of panes the window is split into (detailed only).
      { key: "panes", label: "Panes", kind: "range", min: 1, max: 8, step: 1, role: "window-panes", showIf: (p) => p.shape === "detailed" },
      // Opening heights (3D) — moved here from the native segment Properties. Per-element via roles
      // sill-height / lintel-height (metres); they drive the 3D window opening band.
      { key: "sillHeight", label: "Sill height", kind: "range", min: 0, max: 3, step: 0.05, unit: "m", role: "sill-height" },
      { key: "lintelHeight", label: "Lintel height", kind: "range", min: 0, max: 5, step: 0.05, unit: "m", role: "lintel-height" },
      // Symbol colour (fill + stroke). Per-element via role "window-color"; node param is the fallback.
      { key: "color", label: "Color", kind: "color", role: "window-color" }
    ],
    hint: "Draw a window on each input segment \u2014 polygon (filled), lines (frame + glass), or detailed (panes / mullions)."
  },
  "node-to-object": {
    type: "node-to-object",
    label: "Node to Object",
    color: "#db2777",
    // Places a furniture/fixture symbol (bed / sofa / table / …) on each input node. Mirrors the canvas
    // Node Properties tab with Type = Object: Width × Depth footprint (m), Rotation (°), and which point
    // of the footprint sits ON the node (Anchor). The chosen Kind drives the 2D plan symbol.
    // Schema-driven: wire a Schema into "gin-schema" (or attach one to the canvas/graph) and each node's
    // kind / width / depth / rotation / anchor come from its own schema values by role (object-kind /
    // obj-width / obj-height / obj-rotation / obj-anchor); only "object"-typed nodes are placed.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { kind: "bed", width: 1.5, height: 2, rotation: 0, anchor: "center" },
    fields: [
      { key: "kind", label: "Kind", kind: "select", role: "object-kind", options: PLACE_OBJECT_KIND_OPTIONS },
      { key: "width", label: "Width", kind: "range", min: 0.1, max: 6, step: 0.05, unit: "m", role: "obj-width" },
      { key: "height", label: "Depth", kind: "range", min: 0.1, max: 6, step: 0.05, unit: "m", role: "obj-height" },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "\xB0", role: "obj-rotation" },
      {
        key: "anchor",
        label: "Anchor",
        kind: "select",
        role: "obj-anchor",
        options: [
          { value: "center", label: "Center" },
          { value: "top-left", label: "Top-left" },
          { value: "top-right", label: "Top-right" },
          { value: "bottom-left", label: "Bottom-left" },
          { value: "bottom-right", label: "Bottom-right" }
        ]
      }
    ],
    hint: "Place a furniture symbol (bed / sofa / \u2026) on each input node \u2014 Width \xD7 Depth, Rotation, Anchor and Kind."
  },
  // Data-declared (see ./declarations/layout-gen.node.json) — behaviour stays in code (run actions + rooms editor).
  "layout-gen": buildToolDefFromDeclaration(layout_gen_node_default),
  "pobj-source": {
    type: "pobj-source",
    label: "Parametric Site",
    color: "#0f766e",
    // GEOMETRY SOURCE / HOSTABLE parametric object: evaluates a .pobj definition into its footprint polygon
    // and publishes it as this node's geometry output, while exposing each parameter as a `val-<key>` value
    // output (e.g. offset → val-offset) to drive downstream nodes. OPTIONAL HOST (left input): wire a Space
    // — or a Node / Segment — source in to ATTACH the object to that geometry; its `host` op + pipeline then
    // run over the wired footprint (centroid-anchored, in local metres), exactly like attaching the object to
    // a Space in the Properties tab. Unhosted it evaluates self-contained geometry only (a `host`-based object
    // yields nothing until hosted). Edit values in-node; a wired `valin-def` overrides the stored definition.
    // Commits its footprint as a real Space.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "def", label: "Definition" }],
    defaultParams: { definition: "", props: [] },
    fields: [],
    hint: "Attach to a host by wiring a Space (or Node / Segment) source into the input; its footprint is emitted on the geometry output and each parameter is a val-<key> output \u2192 wire into Inset / Optimise Rectangle.",
    instructions: "A parametric object (.pobj) evaluated to a footprint. ATTACH TO A HOST: wire a Space source (or a Node / Segment) into the left input to host the object on that geometry \u2014 its `host` op and pipeline (e.g. inset \u2192 split \u2192 optimise) run over the wired footprint, just like attaching the object to a Space in the Properties tab. With no host wired it evaluates self-contained geometry only (a `host`-based object yields nothing until hosted). The footprint is emitted on the geometry output \u2014 consume it exactly like a Space source (wire into Inset, then Optimise Rectangle, etc.) or let it commit as a real Space. Every parameter of the object is also published as a value output `val-<key>` (e.g. a param named `offset` \u2192 `val-offset`); wire those into downstream value inputs (e.g. val-offset \u2192 Inset's valin-offset) so one object parameter drives the whole chain. Load a definition with the Import button (or wire a Parametric Object into Definition); edit parameter values directly in the node.",
    materialisesSpace: true
  },
  "grab-object": {
    type: "grab-object",
    label: "Grab Object",
    color: "#0891b2",
    // Reads a canvas Space / Node / Segment (by id, the current selection, OR — preferred — a Space wired into
    // its INPUT) and republishes each parameter of the parametric object attached to it as a `val-<key>` value
    // output, while PASSING THE GEOMETRY THROUGH on its output. So it sits mid-pipeline: Space → Grab Object →
    // Inset/Split/… — the incoming Space's geometry flows on to the op, and the `val-<key>` handles wire into
    // the op's value inputs so the attached object's Properties drive it. With nothing wired in it falls back to
    // its own referenced element (by id / selection). Host resolves the element → its attachment → params,
    // baked into `props` (shown read-only); one amber `val-<key>` endpoint per parameter.
    hasInput: true,
    hasOutput: true,
    defaultParams: { hostKind: "space", grabFromSelection: true, id: "", props: [] },
    fields: [
      { key: "hostKind", label: "Host", kind: "select", options: [{ value: "space", label: "Space" }, { value: "node", label: "Node" }, { value: "segment", label: "Segment" }], showIf: (p) => !p._hasInput },
      { key: "grabFromSelection", label: "Grab from selection", kind: "checkbox", showIf: (p) => !p._hasInput },
      { key: "id", label: "ID", kind: "text", placeholder: "e.g. Space001", showIf: (p) => !p.grabFromSelection && !p._hasInput }
    ],
    hint: "Wire a Space into its input \u2192 passes the geometry through AND exposes that Space's attached object's parameters as val-<key> outputs.",
    instructions: "Republishes the parameters of the parametric object attached to a Space as `val-<key>` value outputs, and passes the Space's GEOMETRY through on its output \u2014 so it belongs mid-pipeline: wire a Space (source) node into its input, then wire its geometry output into an op (Inset / Split / Optimise) and each `val-<key>` into that op's value input (e.g. val-setback \u2192 Inset's valin-uniformSetback). The attached object of whatever Space flows in is what it reads \u2014 the Space node itself needs no parameters. With nothing wired into the input it falls back to its own referenced element: pick the Host kind, and with 'Grab from selection' on it tracks the selected element (turn it off and type an id like Space001 to pin one). NOTE: geometry resolves for Host = Space; Node/Segment emit values only."
  },
  "param-object": {
    type: "param-object",
    label: "Parametric Object",
    color: "#0d9488",
    // Definition SOURCE: a textbox holding a self-contained parametric object (JSON — `parameters` defaults
    // + a `geometry` block of declarative rules). Publishes the definition string on `val-def`; wire that
    // into a Parametric Renderer. No geometry of its own. A wired `valin-def` overrides the typed text.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition in" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: { definition: "" },
    fields: [
      { key: "definition", label: "Definition (JSON)", kind: "textarea", placeholder: "Paste a parametric object definition \u2014 parameters + geometry rules\u2026" }
    ],
    hint: "A self-contained parametric object definition (parameters + geometry rules). Outputs it on val-def \u2192 wire into a Parametric Renderer."
  },
  "param-grab": {
    type: "param-grab",
    label: "Grab Input Parameters",
    color: "#0891b2",
    // Interactive control panel: reads the parametric definition (wired from a Parametric Object into
    // `valin-def`), auto-builds one control per parameter (slider / options / checkbox / textbox — the
    // host bakes the control list into `props` from the definition), and re-publishes the definition on
    // `val-def` with the user's chosen values baked into its parameter defaults. Drop it between a
    // Parametric Object and a Parametric Renderer to tweak the object live.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: { props: [] },
    fields: [],
    hint: "Fetch the parameters of a wired Parametric Object as interactive controls (sliders / options / \u2026) and pass the definition on with your values applied."
  },
  "param-geometry": {
    type: "param-geometry",
    label: "Grab Geometry",
    color: "#0891b2",
    // Read-only INSPECTOR: reads the parametric definition wired into `valin-def` (from a Parametric Object,
    // or downstream of Grab Parameters so it reflects the chosen values), evaluates its geometry block (vars
    // + chosen case + box rules) at the CURRENT parameters, and shows each formula next to its live computed
    // value INLINE in the node. Passes the definition through on `val-def` so it can sit mid-chain. The host
    // bakes the evaluated inspection into `_inspection`. No geometry of its own.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: {},
    fields: [],
    hint: "Inspect a wired Parametric Object's geometry \u2014 each var / box formula with its live computed value. Passes the definition through."
  },
  "param-output-metrics": {
    type: "param-output-metrics",
    label: "Grab Output Metrics",
    color: "#0891b2",
    // Read-only METRICS readout: reads the parametric definition wired into `valin-def` (from a Parametric
    // Object, or downstream of Grab Input Parameters so it reflects the chosen values), and shows the object's
    // OUTPUT metrics inline — both DECLARED outputs (a top-level `outputs` array of named expressions) and a
    // few DERIVED ones (bounding W×D×H, footprint area, volume, shape count). The host bakes the evaluated
    // values into `_outputs`. Passes the definition through on `val-def`. No geometry of its own.
    //
    // EVERY METRIC IS WIREABLE: besides the declared `def` pass-through, the node grows one DYNAMIC
    // `val-<key>` endpoint per metric — declared outputs first, then the derived ones — each anchored to its
    // own readout row. The key is the metric's name reduced to an identifier ("Built-up area" →
    // `val-Built_up_area`), from the shared `paramOutputEntries` so the row, the handle and the value the
    // evaluator publishes always agree. Wire a metric into a Math Engine, an Output slot or any param.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: {},
    fields: [],
    hint: "Read a wired Parametric Object's output metrics (declared `outputs` + derived size/area/volume). Each metric gets its own output endpoint; the definition passes through."
  },
  "node-to-staircase": {
    type: "node-to-staircase",
    label: "Node to Staircase",
    color: "#0f766e",
    // Draws a 2D plan staircase anchored at each input node, in one of three Configurations:
    //  • straight     — a single going (flight of N steps) ending in a landing;
    //  • u-shape      — a half-turn: a flight, a landing, then the remaining steps returning the other way
    //                   (the two parallel flights separated by Mid space; split at Mid steps);
    //  • u-shape-mid  — two 90° turns: a flight → landing → a perpendicular Mid flight (Mid steps) →
    //                   landing → a flight returning opposite the first.
    // Each flight gets a direction arrow showing the ascent. Param-driven (no schema): wire the Nodes
    // bundle (canvas out-1) or a Node source into the input.
    hasInput: true,
    hasOutput: true,
    defaultParams: { config: "straight", steps: 14, tread: 0.28, width: 1, direction: "ltr", midSteps: 0, landingWidth: 1, midSpace: 0.1, landingCuts: 1, rotation: 0, color: "#0f766e" },
    fields: [
      // Overall stair shape.
      {
        key: "config",
        label: "Configuration",
        kind: "select",
        options: [
          { value: "straight", label: "Straight (going + landing)" },
          { value: "u-shape", label: "U-shape (180\xB0 turn)" },
          { value: "u-shape-mid", label: "U-shape + mid flight (2 \xD7 90\xB0)" }
        ]
      },
      // Total number of treads in the stair (distributed across the flights for the multi-flight configs).
      { key: "steps", label: "Number of steps", kind: "range", min: 2, max: 60, step: 1 },
      // Going — the depth of each tread along the run (m).
      { key: "tread", label: "Tread (going)", kind: "range", min: 0.2, max: 0.45, step: 5e-3, unit: "m" },
      // Flight width across the run (m).
      { key: "width", label: "Width", kind: "range", min: 0.6, max: 3, step: 0.05, unit: "m" },
      // Run direction of the FIRST flight: ascent along +x (Left → Right) or -x (Right → Left).
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "ltr", label: "Left \u2192 Right" },
          { value: "rtl", label: "Right \u2192 Left" }
        ]
      },
      // Multi-flight split. U-shape: steps in the FIRST flight (before the landing; rest return). U-shape +
      // mid: steps in the perpendicular MIDDLE flight (the rest split between the two outer flights). 0 →
      // auto (half for U-shape, ~a third for U-shape + mid).
      { key: "midSteps", label: "Mid / split steps", kind: "range", min: 0, max: 40, step: 1, showIf: (p) => p.config !== "straight" },
      // Landing depth along the run (m). Straight: the top landing. U-shape: the turn landing. (U-shape +
      // mid uses square width-sized landings so the perpendicular flights align, so it's hidden there.)
      { key: "landingWidth", label: "Landing depth", kind: "range", min: 0.5, max: 3, step: 0.05, unit: "m", showIf: (p) => p.config !== "u-shape-mid" },
      // Gap between the two parallel flights of a U-shape (half-turn) stair (m).
      { key: "midSpace", label: "Mid space (between flights)", kind: "range", min: 0, max: 1, step: 0.05, unit: "m", showIf: (p) => p.config === "u-shape" },
      // Divide the half-turn landing into n winder slices: lines fan from the inner corner (where the
      // flights meet) to n equally-spaced points on the landing's far edge → (n − 1) lines. 1 = no cuts;
      // 2 = a single mid line; 3 = two diagonals; 4 = two diagonals + a mid line; etc.
      { key: "landingCuts", label: "Landing cuts", kind: "range", min: 1, max: 10, step: 1, showIf: (p) => p.config === "u-shape" },
      // Rotate the whole assembly about the node (°).
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "\xB0" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Draw a 2D staircase on each input node \u2014 Straight (going + landing), U-shape (180\xB0), or U-shape with a perpendicular mid flight (2 \xD7 90\xB0). Steps, Tread, Width, Direction."
  },
  "node-to-footing": {
    type: "node-to-footing",
    label: "Node to Footing",
    color: "#7c3aed",
    // Draws a column-footing SECTION anchored at each input node (column above, foundation layers below):
    //  • spread  — a flat wide RCC pad (T-section);
    //  • sloped  — a frustum (trapezoid) tapering from the frustum-top width to the base width;
    //  • stepped — a stack of widening steps.
    // Below the structural footing sit the PCC and soling beds. Skew offsets the footing under the column
    // (eccentric footing) — Left / Centre / Right. Defaults are the listed imperial sizes in metres
    // (12" col, 60" base, 8" RCC, 4" PCC, 4" soling, 8" frustum height, 24" frustum top). Param-driven (no
    // schema): wire the Nodes bundle (canvas out-1) or a Node source into the input.
    hasInput: true,
    hasOutput: true,
    // Numeric dims are wirable: drive any of them from a Math / Random / Metrics value (e.g. base width
    // computed from the column load). A wired value overrides the slider for that param.
    valueInputs: [
      { key: "baseWidth", label: "Base width" },
      { key: "columnWidth", label: "Column width" },
      { key: "columnHeight", label: "Column height" },
      { key: "rccThickness", label: "RCC thickness" },
      { key: "pccThickness", label: "PCC thickness" },
      { key: "solingThickness", label: "Soling thickness" },
      { key: "frustumHeight", label: "Frustum height" },
      { key: "frustumTopWidth", label: "Frustum top width" },
      { key: "steps", label: "Steps" },
      { key: "rotation", label: "Rotation" }
    ],
    defaultParams: {
      type: "sloped",
      columnWidth: 0.3,
      columnHeight: 1,
      baseWidth: 1.5,
      rccThickness: 0.2,
      pccThickness: 0.1,
      solingThickness: 0.1,
      frustumHeight: 0.2,
      frustumTopWidth: 0.6,
      steps: 3,
      skew: "center",
      rotation: 0,
      color: "#7c3aed"
    },
    fields: [
      {
        key: "type",
        label: "Footing type",
        kind: "select",
        options: [
          { value: "spread", label: "Spread (flat pad)" },
          { value: "sloped", label: "Sloped (frustum)" },
          { value: "stepped", label: "Stepped" }
        ]
      },
      // Column (drawn above the footing). Width = the column section; Height = how much stem to show.
      { key: "columnWidth", label: "Column width", kind: "range", min: 0.1, max: 1.5, step: 0.01, unit: "m" },
      { key: "columnHeight", label: "Column height (shown)", kind: "range", min: 0.2, max: 4, step: 0.05, unit: "m" },
      // Footing base (the widest layer at the bottom of the structural footing).
      { key: "baseWidth", label: "Base width", kind: "range", min: 0.3, max: 5, step: 0.05, unit: "m" },
      // RCC = the structural footing thickness (the pad for spread; total step height for stepped; the
      // slab below the frustum for sloped).
      { key: "rccThickness", label: "RCC thickness", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m" },
      // PCC + soling beds below the structural footing.
      { key: "pccThickness", label: "PCC thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      { key: "solingThickness", label: "Soling thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      // Sloped only: the tapering frustum between the column and the RCC slab.
      { key: "frustumHeight", label: "Frustum height", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" },
      { key: "frustumTopWidth", label: "Frustum top width", kind: "range", min: 0.1, max: 3, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" },
      // Stepped only: how many steps the pad is built from.
      { key: "steps", label: "Steps", kind: "range", min: 1, max: 8, step: 1, showIf: (p) => p.type === "stepped" },
      // Eccentricity — shift the footing under the column (the node stays the column centre).
      {
        key: "skew",
        label: "Skew",
        kind: "select",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" }
        ]
      },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "\xB0" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Draw a column-footing section on each input node \u2014 Spread (flat pad), Sloped (frustum), or Stepped, with RCC / PCC / soling layers and an eccentric Skew."
  },
  footing: {
    type: "footing",
    label: "Footing",
    color: "#6d28d9",
    // DATA node (pure definition, location-free): holds the full engineering definition of a column
    // footing — section type, column W×D×H, base W×D, RCC / PCC / soling depths, frustum dims, step count,
    // eccentric skew. Carries NO view params and NO location; feed its output into Footing → 2D Plan / 2D
    // Elevation / 3D Mesh, then place the result by wiring the view into a Node. Every numeric dim is wirable.
    hasInput: false,
    hasOutput: true,
    valueInputs: [
      { key: "baseWidth", label: "Base width" },
      { key: "baseDepth", label: "Base depth" },
      { key: "columnWidth", label: "Column width" },
      { key: "columnDepth", label: "Column depth" },
      { key: "columnHeight", label: "Column height" },
      { key: "rccThickness", label: "RCC thickness" },
      { key: "pccThickness", label: "PCC thickness" },
      { key: "solingThickness", label: "Soling thickness" },
      { key: "frustumHeight", label: "Frustum height" },
      { key: "frustumTopWidth", label: "Frustum top width" },
      { key: "frustumTopDepth", label: "Frustum top depth" },
      { key: "steps", label: "Steps" },
      { key: "rotation", label: "Rotation" }
    ],
    defaultParams: {
      type: "sloped",
      columnWidth: 0.3,
      columnDepth: 0.3,
      columnHeight: 1,
      baseWidth: 1.5,
      baseDepth: 1.5,
      rccThickness: 0.2,
      pccThickness: 0.1,
      solingThickness: 0.1,
      frustumHeight: 0.2,
      frustumTopWidth: 0.6,
      frustumTopDepth: 0.6,
      steps: 3,
      skew: "center",
      rotation: 0,
      color: "#7c3aed"
    },
    fields: [
      {
        key: "type",
        label: "Footing type",
        kind: "select",
        options: [
          { value: "spread", label: "Spread (flat pad)" },
          { value: "sloped", label: "Sloped (frustum)" },
          { value: "stepped", label: "Stepped" }
        ]
      },
      // Column (above the footing). Width = X, Depth = Z, Height = stem shown.
      { key: "columnWidth", label: "Column width", kind: "range", min: 0.1, max: 1.5, step: 0.01, unit: "m" },
      { key: "columnDepth", label: "Column depth", kind: "range", min: 0.1, max: 1.5, step: 0.01, unit: "m" },
      { key: "columnHeight", label: "Column height (shown)", kind: "range", min: 0.2, max: 4, step: 0.05, unit: "m" },
      // Base pad (the widest layer at the bottom of the structural footing).
      { key: "baseWidth", label: "Base width", kind: "range", min: 0.3, max: 5, step: 0.05, unit: "m" },
      { key: "baseDepth", label: "Base depth", kind: "range", min: 0.3, max: 5, step: 0.05, unit: "m" },
      // Layers below the structural footing.
      { key: "rccThickness", label: "RCC thickness", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m" },
      { key: "pccThickness", label: "PCC thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      { key: "solingThickness", label: "Soling thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      // Sloped only: the tapering frustum between the column and the RCC slab.
      { key: "frustumHeight", label: "Frustum height", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" },
      { key: "frustumTopWidth", label: "Frustum top width", kind: "range", min: 0.1, max: 3, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" || p.type === "stepped" },
      { key: "frustumTopDepth", label: "Frustum top depth", kind: "range", min: 0.1, max: 3, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" || p.type === "stepped" },
      // Stepped only: how many steps the pad is built from.
      { key: "steps", label: "Steps", kind: "range", min: 1, max: 8, step: 1, showIf: (p) => p.type === "stepped" },
      // Eccentricity — shift the footing under the column along its width (X) axis.
      {
        key: "skew",
        label: "Skew",
        kind: "select",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" }
        ]
      },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "\xB0" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Define a column footing on each input node (type, column/base dimensions, RCC/PCC/soling, frustum, skew). Feed into Footing \u2192 2D Plan / 2D Elevation / 3D Mesh."
  },
  "footing-to-plan": {
    type: "footing-to-plan",
    label: "Footing to 2D Plan",
    color: "#7c3aed",
    // Draws the top-down PLAN of each footing from an upstream Footing node — concentric footprint
    // outlines (base, steps, column) in the X–Z plane.
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#7c3aed" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the 2D plan (footprint outlines) of an upstream Footing. Wire into a Node to stamp it at that node's point(s)."
  },
  "footing-to-elevation": {
    type: "footing-to-elevation",
    label: "Footing to 2D Elevation",
    color: "#7c3aed",
    // Draws the column-footing SECTION (elevation) of each footing from an upstream Footing node — column
    // above, then the structural footing and the PCC / soling beds below.
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#7c3aed" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the 2D elevation (section) of an upstream Footing. Wire into a Node to stamp it at that node's point(s)."
  },
  "footing-to-3d-mesh": {
    type: "footing-to-3d-mesh",
    label: "Footing to 3D Mesh",
    color: "#0d9488",
    // Converts each footing from an upstream Footing node into a generic 3D MESH (a stack of lofted prisms
    // — boxes + frustum). Feed the output into Mesh to 3D to view it.
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#7c3aed" },
    fields: [{ key: "color", label: "Color (column)", kind: "color" }],
    hint: "Convert an upstream Footing into a 3D mesh (boxes + frustum). Wire into a Node to place it at the structural point(s), or into Mesh to 3D for an unplaced preview."
  },
  // Data-declared (see ./declarations/mesh-to-3d.node.json) — behaviour stays in code.
  "mesh-to-3d": buildToolDefFromDeclaration(mesh_to_3d_node_default),
  staircase: {
    type: "staircase",
    label: "Staircase",
    color: "#0f766e",
    // DATA node (pure definition, location-free): holds the full definition of a staircase — configuration
    // (straight / u-shape / u-shape-mid), step count, tread, riser, width, direction, landing & mid-flight
    // params. Carries NO view params and NO location; feed into Staircase → 2D Plan / Elevations / 3D Mesh,
    // then place the result by wiring the view into a Node.
    hasInput: false,
    hasOutput: true,
    valueInputs: [
      { key: "steps", label: "Steps" },
      { key: "tread", label: "Tread" },
      { key: "riser", label: "Riser" },
      { key: "width", label: "Width" },
      { key: "midSteps", label: "Mid steps" },
      { key: "landingWidth", label: "Landing depth" },
      { key: "rotation", label: "Rotation" }
    ],
    defaultParams: { config: "straight", steps: 14, tread: 0.28, riser: 0.17, width: 1, direction: "ltr", midSteps: 0, landingWidth: 1, midSpace: 0.1, landingCuts: 1, rotation: 0, color: "#0f766e" },
    fields: [
      {
        key: "config",
        label: "Configuration",
        kind: "select",
        options: [
          { value: "straight", label: "Straight (going + landing)" },
          { value: "u-shape", label: "U-shape (180\xB0 turn)" },
          { value: "u-shape-mid", label: "U-shape + mid flight (2 \xD7 90\xB0)" }
        ]
      },
      { key: "steps", label: "Number of steps", kind: "range", min: 2, max: 60, step: 1 },
      { key: "tread", label: "Tread (going)", kind: "range", min: 0.2, max: 0.45, step: 5e-3, unit: "m" },
      { key: "riser", label: "Riser (rise)", kind: "range", min: 0.1, max: 0.25, step: 5e-3, unit: "m" },
      { key: "width", label: "Width", kind: "range", min: 0.6, max: 3, step: 0.05, unit: "m" },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "ltr", label: "Left \u2192 Right" },
          { value: "rtl", label: "Right \u2192 Left" }
        ]
      },
      { key: "midSteps", label: "Mid / split steps", kind: "range", min: 0, max: 40, step: 1, showIf: (p) => p.config !== "straight" },
      { key: "landingWidth", label: "Landing depth", kind: "range", min: 0.5, max: 3, step: 0.05, unit: "m", showIf: (p) => p.config !== "u-shape-mid" },
      { key: "midSpace", label: "Mid space (between flights)", kind: "range", min: 0, max: 1, step: 0.05, unit: "m", showIf: (p) => p.config === "u-shape" },
      { key: "landingCuts", label: "Landing cuts", kind: "range", min: 1, max: 10, step: 1, showIf: (p) => p.config === "u-shape" },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "\xB0" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Define a staircase (config, steps, tread, riser, width, landings). Feed into Staircase \u2192 2D Plan / Elevations / 3D Mesh, then place via a Node."
  },
  "staircase-to-plan": {
    type: "staircase-to-plan",
    label: "Staircase to 2D Plan",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the 2D plan (flights, landings, tread lines, ascent arrows) of an upstream Staircase. Wire into a Node to stamp it at that node's point(s)."
  },
  "staircase-to-left-elevation": {
    type: "staircase-to-left-elevation",
    label: "Staircase to Left Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the LEFT side elevation (run \xD7 height, stepped profile) of an upstream Staircase. Wire into a Node to place it."
  },
  "staircase-to-right-elevation": {
    type: "staircase-to-right-elevation",
    label: "Staircase to Right Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the RIGHT side elevation (run \xD7 height) of an upstream Staircase. Wire into a Node to place it."
  },
  "staircase-to-front-elevation": {
    type: "staircase-to-front-elevation",
    label: "Staircase to Front Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the FRONT elevation (width \xD7 height) of an upstream Staircase. Wire into a Node to place it."
  },
  "staircase-to-back-elevation": {
    type: "staircase-to-back-elevation",
    label: "Staircase to Back Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the BACK elevation (width \xD7 height) of an upstream Staircase. Wire into a Node to place it."
  },
  "staircase-to-3d-mesh": {
    type: "staircase-to-3d-mesh",
    label: "Staircase to 3D Mesh",
    color: "#0d9488",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Convert an upstream Staircase into a 3D mesh (stacked step boxes). Wire into a Node to place it at the structural point(s), or into Mesh to 3D for an unplaced preview."
  },
  // Data-declared (see ./declarations/schema-to-drawing.node.json) — behaviour stays in code.
  "schema-to-drawing": buildToolDefFromDeclaration(schema_to_drawing_node_default),
  // Data-declared (see ./declarations/schema-to-layers.node.json) — behaviour stays in code.
  "schema-to-layers": buildToolDefFromDeclaration(schema_to_layers_node_default),
  "floorplan-to-front-elevation": {
    type: "floorplan-to-front-elevation",
    label: "Floorplan to Front Elevation",
    color: "#9333ea",
    // Projects the wall / door / window graph onto the FRONT plane (X × height) as a schematic elevation
    // (outline rects + openings at sill/lintel + a ground line). Fed the Canvas Segments bundle; reads
    // wall heights + opening sill/lintel from the attached Schema. Wire into a Node to place it.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Project the plan's walls / openings onto the FRONT elevation. Wire into a Node to place it."
  },
  "floorplan-to-back-elevation": {
    type: "floorplan-to-back-elevation",
    label: "Floorplan to Back Elevation",
    color: "#9333ea",
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Project the plan's walls / openings onto the BACK elevation. Wire into a Node to place it."
  },
  "floorplan-to-left-elevation": {
    type: "floorplan-to-left-elevation",
    label: "Floorplan to Left Elevation",
    color: "#9333ea",
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Project the plan's walls / openings onto the LEFT elevation. Wire into a Node to place it."
  },
  "floorplan-to-right-elevation": {
    type: "floorplan-to-right-elevation",
    label: "Floorplan to Right Elevation",
    color: "#9333ea",
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" }
    ],
    hint: "Project the plan's walls / openings onto the RIGHT elevation. Wire into a Node to place it."
  },
  "views-layout": {
    type: "views-layout",
    label: "Views Layout",
    color: "#0891b2",
    // TERMINAL: routes wired views into the canvas "Views" mode panels instead of placing them at Nodes.
    // Wire a Plan into Top/Plan and the four elevations into Front / Back / Left / Right. The host reads
    // this node from the live flow and renders the panels (plan centre, Back top / Front bottom / L / R).
    hasInput: false,
    hasOutput: false,
    geomInputs: [
      { key: "plan", label: "Plan (top)" },
      { key: "front", label: "Front" },
      { key: "back", label: "Back" },
      { key: "left", label: "Left" },
      { key: "right", label: "Right" }
    ],
    defaultParams: {},
    fields: [],
    hint: 'Route a Plan + the four elevations into the canvas "Views" mode panels (instead of placing them at Nodes).'
  },
  "segment-to-3d": {
    type: "segment-to-3d",
    label: "Segment to 3D",
    color: "#0d9488",
    // Extrudes each input segment (wall) vertically in the 3D view to a custom Height, Up from the floor
    // plane or Down below it. Per-element via roles extrude-height / extrude-direction (graphAttrs); the
    // 3D canvas resolves them, overriding the default storey height for that wall.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 2.7, direction: "up" },
    fields: [
      { key: "height", label: "Height", kind: "range", min: 0, max: 12, step: 0.1, unit: "m", role: "extrude-height" },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        role: "extrude-direction",
        options: [
          { value: "up", label: "Upwards" },
          { value: "down", label: "Downwards" }
        ]
      }
    ],
    hint: "Extrude each input segment into a 3D wall of the given Height, Upwards from the floor or Downwards below it."
  },
  "space-to-3d": {
    type: "space-to-3d",
    label: "Space to 3D",
    color: "#0891b2",
    // Extrudes each input space polygon into a solid 3D mass of the given Height, Up from the floor plane
    // or Down below it (massing / basements). Per-element via roles extrude-height / extrude-direction
    // (graphAttrs.spaces); the 3D canvas renders the mass.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, direction: "up", color: "#94a3b8", opacity: 1, showEdges: true },
    fields: [
      { key: "height", label: "Height", kind: "range", min: 0, max: 60, step: 0.1, unit: "m", role: "extrude-height" },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        role: "extrude-direction",
        options: [
          { value: "up", label: "Upwards" },
          { value: "down", label: "Downwards" }
        ]
      },
      // Appearance of the extruded mass in the 3D view. Per-element via roles extrude-color /
      // extrude-opacity / extrude-edges (graphAttrs.spaces) — the node values are the fallback.
      { key: "color", label: "Color", kind: "color", role: "extrude-color" },
      { key: "opacity", label: "Opacity", kind: "range", min: 0, max: 1, step: 0.05, role: "extrude-opacity" },
      { key: "showEdges", label: "Show Edges", kind: "checkbox", role: "extrude-edges" }
    ],
    hint: "Extrude each input space into a solid 3D mass of the given Height, Upwards from the floor or Downwards below it. Set its Colour, Opacity (for see-through massing) and Show Edges in the 3D view."
  },
  // Data-declared (see ./declarations/mass.node.json) — behaviour stays in code.
  mass: buildToolDefFromDeclaration(mass_node_default),
  // Data-declared (see ./declarations/cuboid.node.json) — behaviour stays in code.
  cuboid: buildToolDefFromDeclaration(cuboid_node_default),
  // Data-declared (see ./declarations/cylinder.node.json) — behaviour stays in code.
  cylinder: buildToolDefFromDeclaration(cylinder_node_default),
  // Data-declared (see ./declarations/sphere.node.json) — behaviour stays in code.
  sphere: buildToolDefFromDeclaration(sphere_node_default),
  // Data-declared (see ./declarations/cone.node.json) — behaviour stays in code.
  cone: buildToolDefFromDeclaration(cone_node_default),
  // Batch-A 3D primitives — rendered host-side by primitiveMasses like cuboid/cylinder/sphere/cone:
  // Frustum (tapered cylinder), Tapered Box (rectangular frustum), Torus (flat ring, partial sweep), Capsule.
  frustum: buildToolDefFromDeclaration(frustum_node_default),
  "tapered-box": buildToolDefFromDeclaration(tapered_box_node_default),
  torus: buildToolDefFromDeclaration(torus_node_default),
  capsule: buildToolDefFromDeclaration(capsule_node_default),
  // Data-declared (see ./declarations/transform-3d.node.json) — behaviour stays in code.
  "transform-3d": buildToolDefFromDeclaration(transform_3d_node_default),
  // Data-declared (see ./declarations/boolean-3d.node.json) — behaviour stays in code.
  "boolean-3d": buildToolDefFromDeclaration(boolean_3d_node_default),
  // Data-declared (see ./declarations/display-3d.node.json) — behaviour stays in code.
  "display-3d": buildToolDefFromDeclaration(display_3d_node_default),
  // Data-declared (see ./declarations/inset-3d.node.json) — behaviour stays in code.
  "inset-3d": buildToolDefFromDeclaration(inset_3d_node_default),
  // Data-declared (see ./declarations/smooth-3d.node.json) — behaviour stays in code.
  "smooth-3d": buildToolDefFromDeclaration(smooth_3d_node_default),
  "voronoi-3d": {
    type: "voronoi-3d",
    label: "Voronoi 3D",
    color: "#0e7490",
    // Mass op: the 3D Voronoi diagram of the input Mass's vertices — each vertex seeds a convex cell
    // (clipped to the Mass's bounding box). Rendered as cell wireframes in the 3D view. Feed a Mass node.
    hasInput: true,
    hasOutput: true,
    defaultParams: {},
    fields: [],
    hint: "3D Voronoi of a Mass's vertices \u2014 each vertex seeds a convex cell (half-space intersection), clipped to the Mass's bounding box. Wire a Mass primitive in; cells render in the 3D view."
  },
  image: {
    type: "image",
    label: "Image",
    color: "#7e22ce",
    // Generator (no input): the imported underlay image. Auto-binds to the canvas's current image and
    // feeds the Image nodes (Vectorisation). Carries no geometry itself.
    hasInput: false,
    hasOutput: true,
    // The image AS A MATRIX (`val-matrix`) — the bridge from the raster into the Matrix / Grid nodes,
    // mirroring what Grid Geometry does for a grid-field. Per-pixel luminance 0..1, row-major, and
    // DOWNSAMPLED (long edge capped, see IMAGE_MATRIX_MAX_EDGE in evaluateFlow) because values travel
    // between nodes as JSON strings and a full-resolution photo would be megabytes on every eval. The
    // node body shows no matrix box — the data lives on the wire, not on the node.
    // `matrix` is the pixels; the five that follow are WHERE THOSE PIXELS ARE. The matrix alone is just
    // numbers on a wire with no world box, so anything derived from it had to be placed BY HAND — a typed
    // image width and origin that only ever approximated the underlay, and drifted the moment the picture
    // was moved or rescaled. These publish the real placement in the same anchor-relative METRES every
    // other value output speaks, so a Math Engine can put its result back exactly on top of the picture it
    // read. `cellM` is the one to reach for: the matrix is DOWNSAMPLED, so one cell is several image
    // pixels, and this is that cell's size in metres — exact, unlike width ÷ columns, which smears the
    // last partial cell's rounding across every cell.
    // `image` is the picture ITSELF as a `data:` URL — the underlay's own bytes, not a re-render. It is
    // what an Analyse / Render node's File / Image input wants, so the plan already on canvas can be sent
    // to a model without a File Upload node asking for the same file a second time. The matrix cannot
    // serve that purpose: it is downsampled to a luminance grid, which is unreadable as a drawing.
    valueOutputs: [
      { key: "id", label: "Image id" },
      { key: "image", label: "Image (data URL)" },
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "matrixR", label: "Red (JSON)" },
      { key: "matrixG", label: "Green (JSON)" },
      { key: "matrixB", label: "Blue (JSON)" },
      { key: "originX", label: "Origin X", unit: "m" },
      { key: "originY", label: "Origin Y", unit: "m" },
      { key: "cellM", label: "Cell size", unit: "m" },
      { key: "widthM", label: "Image width", unit: "m" },
      { key: "heightM", label: "Image height", unit: "m" }
    ],
    // WHICH PICTURE. Blank is the base underlay — the imported drawing, and what every flow written
    // before overlays existed goes on reading. Naming an overlay ("render-1") points this node, and the
    // Vectorisation / Object Detection chain hanging off it, at that picture instead. A name with no
    // overlay behind it falls back to the base rather than going dark, so deleting an overlay degrades
    // to the original drawing instead of silently emptying the branch.
    // Which channel `val-matrix` carries. Every option is oriented LOW = INK, so one `value ≤ threshold`
    // test downstream means "ink" whichever is picked. Distance to colour is the general form of the
    // Vectorisation node's Colour + Tolerance pair — any target colour, with the consumer's own threshold
    // acting as the tolerance. These live on the node rather than being wireable BY DESIGN: the Image node
    // is a root, so an edge back into it from an Input Properties brief would close a cycle, and
    // evaluateFlow's topological sort bails on one.
    defaultParams: { grabFromSelection: true, id: "", channel: "luma", inkColor: "#000000", pooling: "mean" },
    fields: [
      // POOLING is a property of the SOURCE - how the raster is sampled - which is why it belongs here
      // and the removed "Read" selector did not: which channel counts as ink is a question about the
      // trace. Mean box-filters and is right for a photograph; Ink reports each block's darkest pixel,
      // which is what keeps a 1 px coloured hairline alive through the 128-cell downsample instead of
      // averaging it into the paper. Mean stays the default so existing flows are untouched.
      { key: "pooling", label: "Sampling", kind: "select", options: [
        { value: "mean", label: "Mean (photographic)" },
        { value: "ink", label: "Ink (keep hairlines)" }
      ] },
      // Same pair every other source node carries: a checkbox that FOLLOWS the canvas selection, and the
      // id it writes, which stays editable when the checkbox is off. On by default, matching Graph /
      // Segment / Node — a node dropped while a picture is selected should already be reading it.
      { key: "grabFromSelection", label: "Grab from selection", kind: "checkbox" },
      { key: "id", label: "Image", kind: "text", placeholder: "blank = the imported plan; or render-1 \u2026" }
      // NO "Read" SELECTOR. `channel` and `inkColor` are still read below and still drive `val-matrix`,
      // so a flow that sets them keeps working — they simply have no control on the node any more.
      // They were a Vectorisation-era detail on a node that is now the Geometry node's Image kind, and
      // the wrong place for it either way: which channel counts as ink is a question about the TRACE,
      // and Vectorisation has its own Colour mode for exactly that. Leaving the pair here offered two
      // answers to one question, on two different nodes, with only one of them consulted by the tracer.
      // `inkColor` goes with it: it only ever appeared for `channel: "dist"`, which is now unreachable
      // from the UI, so a colour swatch that can never be shown is not a control, it is dead weight.
    ],
    hint: "The imported underlay image (auto-connects to the canvas image, or to whichever picture is selected). `val-image` is the picture's own bytes as a data URL \u2014 what an Analyse or Render node's File input wants. `val-matrix` publishes it as a downsampled 0..1 luminance matrix (LOW = ink) for the Matrix / Grid nodes, and the four placement outputs say where those pixels are, in metres. Feeds Vectorisation, which picks its own colour to trace."
  },
  vectorise: {
    type: "vectorise",
    label: "Vectorisation",
    color: "#9333ea",
    // Traces the input image's lines into a PROPERLY CONNECTED node/edge graph in world coords: colour
    // mask → despeckle → gap close → skeleton → spur prune → simplify → vertex snap → endpoint bridging
    // (T-junctions) → ortho straighten → collinear merge. Output feeds the Graph nodes (Mitered Join /
    // Graph to Spaces / Metrics).
    hasInput: true,
    // VALUE-ONLY: the trace leaves on `val-graph`, never as geometry, and the node draws nothing —
    // `drawsNothing` therefore hides the canvas-visibility (eye) toggle, which would have nothing to
    // toggle. Wire the graph into Network / Polygon to see it, or into any Graph node to work on it.
    hasOutput: false,
    drawsNothing: true,
    // EVERY tracing parameter is wireable, not just the four that used to be. The kernel already reads
    // them all through `{ ...data.params, ...vin }`, so the list below was the only thing standing between
    // a brief and the trace: a flow that puts the whole tuning set on ONE Input Properties node — the
    // shape detect_* flows already use — needs an endpoint per row, or half the brief silently does
    // nothing. Ordered as the sliders are, so the endpoints read top-to-bottom like the panel.
    valueInputs: [
      { key: "colorMode", label: "Colour" },
      { key: "tolerance", label: "Tolerance" },
      { key: "despeckle", label: "Despeckle" },
      { key: "dilate", label: "Gap close" },
      { key: "spurLength", label: "Prune spurs" },
      { key: "simplifyEpsilon", label: "Simplify" },
      { key: "minLength", label: "Min length" },
      { key: "snapTolerance", label: "Node snap" },
      { key: "connectGap", label: "Bridge gaps" },
      { key: "mergeAngle", label: "Straighten" },
      { key: "orthoSnap", label: "Ortho snap" },
      { key: "orthoTol", label: "Ortho window" },
      { key: "tuneMinArea", label: "Min space area" },
      { key: "tuneColour", label: "Tune colour too" }
    ],
    // The vector result, plus the live trace-quality readouts (also the Auto-Tune objective): closed
    // faces ≥ Min space area, dangling degree-1 endpoints (broken loops), and traced polyline count.
    valueOutputs: [
      { key: "graph", label: "Graph (JSON)" },
      { key: "nodes", label: "Nodes" },
      { key: "edges", label: "Edges" },
      { key: "spaces", label: "Spaces" },
      { key: "openEnds", label: "Open ends" },
      { key: "lines", label: "Lines" }
    ],
    defaultParams: {
      colorMode: "black",
      tolerance: 50,
      despeckle: 12,
      dilate: 3,
      spurLength: 10,
      simplifyEpsilon: 2,
      minLength: 30,
      snapTolerance: 8,
      connectGap: 12,
      mergeAngle: 7,
      orthoSnap: 0,
      orthoTol: 10,
      tuneMinArea: 1,
      tuneColour: false
    },
    fields: [
      {
        key: "colorMode",
        label: "Colour",
        kind: "select",
        options: [
          { value: "black", label: "Black" },
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
          { value: "green", label: "Green" },
          { value: "all", label: "All (non-white)" }
        ]
      },
      // Colour-match tolerance — higher matches more shades of the chosen colour.
      { key: "tolerance", label: "Tolerance", kind: "range", min: 5, max: 120, step: 1 },
      // Remove noise blobs (text, hatching, stamps) below this area before tracing.
      { key: "despeckle", label: "Despeckle", kind: "range", min: 0, max: 400, step: 4, unit: "px\xB2" },
      // Morphological close kernel — bridges pixel-level breaks in dashed/anti-aliased lines.
      { key: "dilate", label: "Gap close", kind: "range", min: 1, max: 15, step: 2, unit: "px" },
      // Erase skeleton whiskers (thick-wall thinning artefacts) shorter than this off junctions.
      { key: "spurLength", label: "Prune spurs", kind: "range", min: 0, max: 60, step: 1, unit: "px" },
      // Douglas–Peucker tolerance — higher collapses wobbly pixel runs into straighter segments.
      { key: "simplifyEpsilon", label: "Simplify", kind: "range", min: 0, max: 12, step: 0.1, unit: "px" },
      // Discard traced lines (and leftover dangling whiskers) shorter than this.
      { key: "minLength", label: "Min length", kind: "range", min: 0, max: 300, step: 1, unit: "px" },
      // Cluster vertices within this radius into one shared graph node.
      { key: "snapTolerance", label: "Node snap", kind: "range", min: 0, max: 30, step: 1, unit: "px" },
      // Connect dangling endpoints to the nearest node or edge (makes T-junctions) within this reach.
      { key: "connectGap", label: "Bridge gaps", kind: "range", min: 0, max: 80, step: 1, unit: "px" },
      // Collapse pass-through nodes whose edges deviate less than this from a straight line.
      { key: "mergeAngle", label: "Straighten", kind: "range", min: 0, max: 30, step: 0.5, unit: "\xB0" },
      // Snap near-horizontal/vertical runs onto the image axes (great for floorplans).
      { key: "orthoSnap", label: "Ortho snap", kind: "checkbox" },
      // How far off-axis an edge may be and still get squared up.
      { key: "orthoTol", label: "Ortho window", kind: "range", min: 1, max: 30, step: 1, unit: "\xB0", showIf: (p) => !!p.orthoSnap },
      // Auto-Tune scoring floor: faces smaller than this don't count as spaces (text boxes, hatching).
      { key: "tuneMinArea", label: "Min space area", kind: "range", min: 0, max: 50, step: 0.5, unit: "m\xB2" },
      // Auto-Tune also sweeps the colour mode (for drawings whose line colour is unknown).
      { key: "tuneColour", label: "Tune colour too", kind: "checkbox" }
    ],
    hint: "Trace the image's lines into a connected node/edge graph \u2014 colour filter, despeckle, gap-close, spur pruning, simplify, vertex snap, endpoint bridging (T-junctions), ortho straightening and collinear merging. VECTOR OUT ONLY: the result leaves on val-graph as node/edge JSON in metres (with val-nodes / val-edges counts) and the node draws nothing \u2014 wire the graph into Fit Lines, Graph to Spaces, Network or Polygon. AUTO-TUNE loops these parameters against the image, scores each combo on closed spaces found (minus noise faces and open ends) and bakes the best values back into the sliders \u2014 no manual hit-and-trial; judge it on the Spaces / Open ends / Lines readouts."
  },
  "object-detection": {
    type: "object-detection",
    label: "Object Detection",
    color: "#a21caf",
    // Pure VALUE node: detects objects in the input image (Gemini) and publishes their bounding boxes as
    // MATH values — a nested polygon list and a node/edge graph — instead of emitting geometry. The async
    // detect bakes `_boxes` (world polygons); the eval reads them and republishes in anchor-relative
    // metres. It has NO geometry output: wire `val-polygons` into a Polygon node, or `val-graph` into a
    // Network node, to draw the boxes — which keeps the detection composable with the Math / Graph nodes
    // rather than dumping one Space per object. Mirrors Image Tools → Object Detection (box mode).
    hasInput: true,
    hasOutput: false,
    // THE THREE SETTINGS A BRIEF NEEDS TO REACH. Key, model and Max items were params only, so a flow
    // that gathers every input into one Input Properties panel had nowhere to put them and the detection
    // node stayed a second place to configure. Wired values are baked back onto the params (see the
    // object-detection branch in FlowOverlay's bake pass), because DETECT is a button that reads params
    // rather than the live graph — without that bake a wired key would resolve in the preview and still
    // be missing at the moment it is pressed.
    valueInputs: [
      { key: "api_key", label: "API key" },
      { key: "model", label: "Model" },
      { key: "maxItems", label: "Max items" }
    ],
    // On top of these fixed endpoints the node publishes ONE DYNAMIC endpoint per "Add object" row
    // (`val-<rowId>`, rendered from params.objects like Input Properties renders its props) plus
    // `val-unmatched` — see the detection branch in evaluateFlow.
    valueOutputs: [
      { key: "polygons", label: "Polygons (JSON)" },
      // FLAT corner matrix — one row per box [x0,y0,x1,y1,x2,y2,x3,y3], anchor-relative metres. The form
      // a Math Engine can lift directly: the nested ring list on `polygons` parses to zeros there (a ring
      // is not a number), so this is the endpoint that lets detection wire straight into `expr` with no
      // Graph to Matrix bridge. Per-row twins exist too (`val-<rowId>_corners`).
      { key: "corners", label: "Corners (N\xD78, row per box)" },
      { key: "points", label: "Points (JSON)" },
      { key: "labels", label: "Labels (JSON)" },
      { key: "graph", label: "Graph (JSON)" },
      { key: "count", label: "Objects" },
      { key: "area", label: "Total area", unit: "m\xB2" }
    ],
    defaultParams: { api_key: "", model: "gemini-robotics-er-2-preview", targets: "", maxItems: 20, shape: "polygon", objects: [] },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Gemini API key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-robotics-er-2-preview" },
      // Free-text fallback — only meaningful when NO object rows are configured (rows drive the ask).
      { key: "targets", label: "Detect", kind: "text", placeholder: "e.g. trees, cars (blank = all)", showIf: (p) => !(Array.isArray(p.objects) && p.objects.length) },
      // PER OBJECT once rows exist: the cap sent to the model is this × the number of rows, so adding a
      // row can't starve the classes listed after it.
      { key: "maxItems", label: "Max items", kind: "range", min: 1, max: 50, step: 1 },
      // WHAT the model is asked to return: the object's boundary, a point on it, or both in one call.
      // Gemini's spatial models answer either form natively — this is the ask, not a post-process.
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "polygon", label: "Polygon (boundary)" },
          { value: "point", label: "Point" },
          { value: "both", label: "Both" }
        ]
      }
    ],
    hint: "Detect objects in the image \u2192 their geometry as MATH values. ADD OBJECT lists what to find (door, window, room, \u2026): every row goes into ONE prompt, so it stays a single API call, and the reply is split back so each row gets its OWN endpoint. Because the row name is both the ask and the split term, the two can't drift apart. Shape is chosen once for the whole node \u2014 Polygon (boundary), Point, or Both \u2014 so every row endpoint carries the same kind of value: a nested [[[x,y],\u2026],\u2026] metre ring list, or an N\xD72 metre point matrix. `val-unmatched` collects anything the model returned that no row claimed, so nothing is silently lost. The fixed endpoints still publish the whole reply: val-polygons, val-points, val-labels, val-graph, val-count, val-area. With no rows added it falls back to the free-text Detect field. No geometry output \u2014 wire a row into a Polygon node, a Label Graph, or a Point / Place Object node. Needs a Gemini key; click Detect.",
    instructions: 'Reads the drawing SEMANTICALLY \u2014 what a thing IS and roughly WHERE \u2014 and publishes it as values. Vectorisation reads geometry and cannot tell a door from a gap; this can, and the two are meant to be used together.\n\nSETUP\n1. Paste a Gemini API key. Without one this node produces nothing while everything downstream still evaluates, so a missing key looks exactly like "the drawing had no doors" \u2014 check the key before believing an empty result.\n2. Wire an Image node in (plain geometry edge, no handles). It reads whatever is on the canvas, title block and legend included.\n3. Press DETECT. It is an ASYNCHRONOUS, MANUAL action: the pass runs against the image and bakes its result into the node. Nothing detects on its own, and re-running the flow does NOT re-detect \u2014 press it again after changing the image or the rows.\n\nADD OBJECT ROWS \u2014 the main control\nEach row is one class to find: "Door", "Window", "Room", "Furniture". Every row goes into a SINGLE prompt, so four rows still cost ONE API call \u2014 billed per image, so four separate nodes would cost roughly four times as much for the same reading. The reply is split back by row, and each row publishes:\n  \u2022 val-<rowId>         \u2014 its own geometry (rings, or points)\n  \u2022 val-<rowId>_labels  \u2014 the individual names the model returned for that row\n  \u2022 val-<rowId>_count   \u2014 how many it claimed\nMatching is CASE-INSENSITIVE and BIDIRECTIONAL containment, so a row named "door" claims "Door", "sliding door" and "doorway". Name rows in the singular and keep them short.\n\nSHAPE is chosen ONCE for the whole node, so every row carries the same kind of value:\n  \u2022 Polygon \u2014 a nested [[[x,y],\u2026],\u2026] metre ring list. Draw with a Render 2D POLYGON row.\n  \u2022 Point   \u2014 an N\xD72 metre matrix (which IS a point list). Draw with a Render 2D CIRCLE row.\n  \u2022 Both    \u2014 a boundary and a point per object, paired by index.\nPick the one the downstream node wants: a boundary to outline a room, a point to place an object.\n\nMAX ITEMS is PER ROW once rows exist, so adding a row cannot starve the classes after it. Keep it near the real count \u2014 a 6-room plan does not need 50.\n\nCHECK val-unmatched. It collects everything the model returned that no row claimed. A row reading 0 while unmatched is full means the model used a different word \u2014 rename the row to match, do not raise Max items.\n\nWHAT THE RESULT IS, AND IS NOT\nThis node has NO geometry output and commits nothing: a detection is a READING of the image, not a decision about the plan, so you choose what to draw. Boundaries are axis-aligned and approximate \u2014 NEVER take a boundary edge as a wall line. Use detection for what a thing IS and roughly WHERE; use Vectorisation / Fit Lines for exactly where its edges are. Good uses: naming traced Spaces by overlapping detected rooms, placing openings where the drawing actually shows them rather than by rule, and putting objects at detected points.\n\nFilter by Label splits one mixed detection into families; Label Graph names each component from a labels array; Merge Graph unions the families into one typed graph.'
  },
  render: {
    type: "render",
    label: "Render",
    color: "#1d4ed8",
    hasInput: false,
    hasOutput: false,
    // Action node (not a geometry/recipe op): sends the wired image(s) with the prompt to a Google AI
    // image model, then shows the result + a download link.
    //
    // WHAT IT SENDS IS EXACTLY WHAT YOU GAVE IT — the system prompt, the prompt and the wired image(s),
    // and nothing else. It used to do more: a geometry input framed a camera, a `padding` slider grew
    // that frame, and an unwired Image input fell back to photographing the 3D view. Every one of those
    // put content into the request that the author never wrote, which is indefensible for a node whose
    // whole job is to carry an instruction faithfully — a prompt asking for a schematic line drawing
    // would be answered with a rendering of a 3D view it silently captured. There is no camera to aim
    // any more, so the geometry input is gone with it, and a missing image is an ERROR rather than a
    // substitution. `generationConfig.responseModalities` is the one thing still set here: it is the
    // wire protocol for asking the endpoint for an image at all, not content.
    //
    // The PROMPT is a value input as well as a field, so a Text / Math Engine / Analyse node can compose
    // it in the flow (the Agent node cannot: it only ever writes range/number/select/checkbox params).
    //
    // THREE INPUTS, and they are three different things:
    //  • IMAGE — what to render. Wire a Snapshot's `val-image` (the 2D plan as drawn) or an Image node's
    //    `val-image` (the underlay's own bytes). REQUIRED: one of Image / 3D image must resolve to a
    //    data URL, or the run stops and says so.
    //  • 3D IMAGE — the SAME subject from above, for a Snapshot's `val-image-3d`. Both images are sent
    //    together when both are wired, in that order, so the model reads the plan for what the geometry IS
    //    and the 3D shot for how it stands. Either alone works; the pair is the point.
    //  • PROMPT — what to render THIS time. The per-run instruction.
    //  • SYSTEM PROMPT — how the model should behave, every time. Sent as Gemini's `systemInstruction`
    //    rather than folded into the prompt, so the standing rules ("hold the geometry, never move
    //    anything") cannot be diluted by whatever the per-run prompt happens to say.
    valueInputs: [{ key: "image", label: "Image" }, { key: "image3d", label: "3D image" }, { key: "prompt", label: "Prompt" }, { key: "systemPrompt", label: "System prompt" }],
    // The generated picture, as a data URL. Empty until the button has been pressed — this is an ACTION
    // node, so the value appears when a run bakes `_resultUrl` and not on evaluation.
    valueOutputs: [{ key: "image", label: "Image (data URL)" }],
    // A fresh Render node starts BLANK — every field included. The system prompt used to ship an
    // architectural-visualiser persona ending "Render materials and light only", which is a reasonable
    // default for exactly one use and silently contradicts every other: a prompt asking for a flat
    // schematic of coloured lines would be overruled by a standing rule the author never wrote and had
    // no reason to look for. What the model is told is now entirely what is typed or wired here.
    defaultParams: {
      name: "",
      api_key: "",
      model: "gemini-3.1-flash-image-preview",
      systemPrompt: "",
      prompt: ""
    },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Google AI Studio key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-3.1-flash-image-preview" },
      { key: "systemPrompt", label: "System prompt", kind: "textarea", placeholder: "How the model should behave \u2014 the standing rules\u2026" },
      { key: "prompt", label: "Prompt", kind: "textarea", placeholder: "What to render this time\u2026" }
    ],
    hint: "Render an image with Google AI. Four inputs: Image and 3D image (wire an Image node's underlay bytes, or a Snapshot's plan and top-view outputs \u2014 both are sent together when both are wired; one of the two is required), Prompt (what to render now) and System prompt (the standing rules, sent as systemInstruction). All four can be wired or typed. Only these are sent \u2014 the node adds nothing of its own."
  },
  // Data-declared (see ./declarations/hatching.node.json) — behaviour stays in code.
  hatching: buildToolDefFromDeclaration(hatching_node_default),
  // Data-declared (see ./declarations/display-segment.node.json) — behaviour stays in code.
  "display-segment": buildToolDefFromDeclaration(display_segment_node_default),
  // Data-declared (see ./declarations/display-node.node.json) — behaviour stays in code.
  "display-node": buildToolDefFromDeclaration(display_node_node_default),
  // Data-declared (see ./declarations/bua.node.json) — behaviour stays in code.
  bua: buildToolDefFromDeclaration(bua_node_default),
  // Data-declared (see ./declarations/math.node.json) — behaviour stays in code.
  math: buildToolDefFromDeclaration(math_node_default),
  // Data-declared (see ./declarations/random.node.json) — behaviour stays in code.
  random: buildToolDefFromDeclaration(random_node_default),
  // ── Parametric-object decomposition (read-only) — nodes emitted by "Load Parametric Object" to visualise
  //    a .pobj.json's vars (Expression) + geometry rules (Create Polygon / Segment / Arc / Box) as a graph.
  //    These are display-only: the flow evaluator ignores them (evalNode default), so they annotate structure
  //    without recomputing geometry. ──
  // Data-declared (see ./declarations/expr.node.json) — display-only node (evaluator ignores it).
  expr: buildToolDefFromDeclaration(expr_node_default),
  output: {
    type: "output",
    label: "Output Metrics",
    color: "#0d9488",
    // A collector: wire any node's `val-*` output into one of its named slots; the slot's value is surfaced
    // live on the node and in the Space's Metrics tab. Slots auto-grow + are user-named, so its endpoints
    // are dynamic (driven by params.slots) rather than the static valueInputs list.
    //
    // Each slot PUBLISHES what it collected too, on `val-<slotId>` — the mirror of its own `valin-<slotId>`,
    // on the same row — so the node can sit mid-chain rather than only terminating: read a metric, show it,
    // pass it on. Both endpoints are keyed by the SLOT ID, never the label, so renaming a slot cannot move a
    // wire. An unwired slot publishes nothing, leaving a downstream consumer on its own value.
    hasInput: false,
    hasOutput: false,
    defaultParams: { slots: [{ id: "s1", label: "" }] },
    fields: [],
    hint: "Collect values from any node into named metrics (shown in the Metrics tab). Each slot also re-publishes its value."
  },
  // Data-declared (see ./declarations/space-geometry.node.json) — behaviour stays in code.
  "space-geometry": buildToolDefFromDeclaration(space_geometry_node_default),
  // Data-declared (see ./declarations/merge.node.json) — behaviour stays in code.
  merge: buildToolDefFromDeclaration(merge_node_default),
  // Data-declared (see ./declarations/boolean-2d.node.json) — behaviour stays in code.
  "boolean-2d": buildToolDefFromDeclaration(boolean_2d_node_default),
  // Data-declared (see ./declarations/input-props.node.json) — behaviour stays in code (dynamic prop outputs).
  "input-props": buildToolDefFromDeclaration(input_props_node_default),
  // Data-declared (see ./declarations/file-upload.node.json) — behaviour stays in code.
  "file-upload": buildToolDefFromDeclaration(file_upload_node_default),
  // Data-declared (see ./declarations/text.node.json) — behaviour stays in code.
  text: buildToolDefFromDeclaration(text_node_default),
  // Data-declared (see ./declarations/prompt-builder.node.json) — fills a {name} template from its
  // wired values. The step between the flow's numbers and a model's words: the Math Engine cannot
  // concatenate strings and Text only passes one through, so nothing else can build a prompt.
  "prompt-builder": buildToolDefFromDeclaration(prompt_builder_node_default),
  // Data-declared (see ./declarations/plan-json.node.json) — the canvas model as JSON on a wire,
  // scoped to the wired Space. The only node that can say what a segment IS and what object is on it.
  "plan-json": buildToolDefFromDeclaration(plan_json_node_default),
  // Data-declared (see ./declarations/filter-by-space.node.json) — the scoping half of Plan JSON, split
  // out so the region can be any wired Space rather than only the canvas selection.
  "filter-by-space": buildToolDefFromDeclaration(filter_by_space_node_default),
  analyse: {
    type: "analyse",
    label: "Analyse",
    color: "#1d4ed8",
    // Action node (like Render): sends a media file (PDF / image / audio / video) to Gemini with a system
    // prompt and shows the model's text answer. The media comes from EITHER the File input (a data URL —
    // wire a File Upload node's val-data here) OR the Url input / Url field (an http(s) link; the node
    // fetches the bytes and inlines them). The analysis text is also published on `val-result` for wiring.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "file", label: "File" }, { key: "url", label: "Url" }],
    valueOutputs: [{ key: "result", label: "Result" }],
    defaultParams: {
      api_key: "",
      model: "gemini-2.5-flash",
      url: "",
      systemPrompt: "Analyse the attached file and describe its contents in detail."
    },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Google AI Studio key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-2.5-flash" },
      // Url input: type a link here, or wire a value into the Url endpoint (valin-url) to override it.
      { key: "url", label: "Url", kind: "text", placeholder: "https://\u2026 (or wire the Url input)" },
      { key: "systemPrompt", label: "System Prompt", kind: "textarea", placeholder: "What should Gemini do with the file?" }
    ],
    hint: "Send a file (PDF/image/audio/video) or URL to Gemini with a system prompt \u2192 text analysis (val-result)."
  },
  generate: {
    type: "generate",
    label: "Generate",
    color: "#7c3aed",
    // Action node (like Render): text-to-media generation via the Google AI / Gemini API. The "Kind"
    // dropdown picks image / video / music and swaps the model to that kind's default (see
    // GENERATE_DEFAULT_MODEL): image → Gemini 2.5 Flash Image (generateContent), video → Veo 3
    // (predictLongRunning + poll), music → Lyria RealTime (live websocket). The result is shown on the
    // node with a download link. No geometry.
    hasInput: false,
    hasOutput: false,
    defaultParams: { kind: "image", api_key: "", model: "gemini-2.5-flash-image", prompt: "", searchWeb: false },
    fields: [
      {
        key: "kind",
        label: "Kind",
        kind: "select",
        options: [
          { value: "image", label: "Image" },
          { value: "video", label: "Video" },
          { value: "music", label: "Music" },
          { value: "text", label: "Text" }
        ]
      },
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Google AI Studio key" },
      { key: "model", label: "Model", kind: "text", placeholder: "model id" },
      { key: "prompt", label: "Prompt", kind: "textarea", placeholder: "Describe what to generate\u2026" },
      // Text only: ground the answer with Google Search (Gemini's google_search tool).
      { key: "searchWeb", label: "Search web", kind: "checkbox", showIf: (p) => p.kind === "text" }
    ],
    hint: "Generate image / video / music from a prompt (Google AI) \u2014 the result is downloadable."
  }
};

// src/floorplan/flow/eval/evalNodes.ts
var PolygonClippingNS2 = __toESM(require_polygon_clipping_cjs2(), 1);

// src/floorplan/flow/eval/parametricObject.ts
var PolygonClippingNS3 = __toESM(require_polygon_clipping_cjs2(), 1);

// src/floorplan/flow/eval/evaluateFlow.ts
function decodeCanvasJson(gp) {
  const r = (v) => Math.round(v * 1e4) / 1e4;
  let payload = {};
  if (gp.json && typeof gp.json === "object" && !Array.isArray(gp.json)) payload = gp.json;
  else try {
    const parsed = JSON.parse(String(gp.json ?? ""));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
  } catch {
  }
  let typeNames = ["wall", "door", "window"];
  try {
    const tn = Array.isArray(gp.typeNames) ? gp.typeNames : JSON.parse(String(gp.typeNames ?? ""));
    if (Array.isArray(tn) && tn.length) typeNames = tn.map((t) => String(t).trim().toLowerCase());
  } catch {
  }
  const num = (v) => {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  };
  const pt = (v) => Array.isArray(v) && v.length >= 2 ? [r(num(v[0])), r(num(v[1]))] : null;
  const segs = Array.isArray(payload.segments) ? payload.segments : [];
  const eA = [], eB = [], eT = [], eL = [], eK = [];
  for (const sg of segs) {
    const a = pt(sg.from), b = pt(sg.to);
    if (!a || !b) continue;
    eA.push(a);
    eB.push(b);
    eT.push([r(num(sg.thicknessM))]);
    eL.push([sg.lengthM != null ? r(num(sg.lengthM)) : r(Math.hypot(b[0] - a[0], b[1] - a[1]))]);
    const own = String(sg.type ?? "").trim().toLowerCase();
    const objs = (Array.isArray(sg.objects) ? sg.objects : [sg.objectId]).filter(Boolean).map((o) => String(o).toLowerCase());
    let code = 0;
    typeNames.forEach((name, ti) => {
      if (!name) return;
      if (own === name || objs.some((o) => o.startsWith(name))) code = ti + 1;
    });
    eK.push([code]);
  }
  const spaceList = Array.isArray(payload.spaces) ? payload.spaces : payload.space && typeof payload.space === "object" ? [payload.space] : [];
  const sp = [], ar = [];
  spaceList.forEach((s0, gi) => {
    const ring = Array.isArray(s0.boundary) ? s0.boundary : [];
    let any = false;
    for (const v of ring) {
      const q = pt(v);
      if (q) {
        sp.push([q[0], q[1], gi]);
        any = true;
      }
    }
    if (any) ar.push([r(num(s0.areaM2))]);
  });
  const nodeList = Array.isArray(payload.nodes) ? payload.nodes : [];
  const nd = [];
  const nk = [];
  const ndIds = [];
  for (const n0 of nodeList) {
    const p = pt(n0.at);
    if (!p) continue;
    nd.push(p);
    ndIds.push(String(n0.id ?? ""));
    const objs = (Array.isArray(n0.objects) ? n0.objects : [n0.objectId]).filter(Boolean).map((o) => String(o).toLowerCase());
    let code = 0;
    typeNames.forEach((name, ti) => {
      if (name && objs.some((o) => o.startsWith(name))) code = ti + 1;
    });
    nk.push([code]);
  }
  const keyList = (v) => {
    if (Array.isArray(v)) return v.map((k) => String(k).trim()).filter(Boolean);
    const s = String(v ?? "").trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((k) => String(k).trim()).filter(Boolean);
    } catch {
    }
    return s.split(",").map((k) => k.trim()).filter(Boolean);
  };
  const nodeKeys = keyList(gp.nodeParams);
  const segKeys = keyList(gp.segParams);
  const paramMatrix = (list, keys) => {
    const vals = [], have = [];
    for (const el of list) {
      const ps = el.params && typeof el.params === "object" && !Array.isArray(el.params) ? el.params : {};
      const vRow = [], hRow = [];
      for (const k of keys) {
        const raw = ps[k];
        const n2 = typeof raw === "boolean" ? raw ? 1 : 0 : Number(raw);
        const ok = raw != null && raw !== "" && Number.isFinite(n2);
        vRow.push(ok ? r(n2) : 0);
        hRow.push(ok ? 1 : 0);
      }
      vals.push(vRow);
      have.push(hRow);
    }
    return { vals, have };
  };
  const segsUsed = segs.filter((sg) => pt(sg.from) && pt(sg.to));
  const nodeP = paramMatrix(nodeList.filter((n0) => pt(n0.at)), nodeKeys);
  const segP = paramMatrix(segsUsed, segKeys);
  const nodeAt = /* @__PURE__ */ new Map();
  nd.forEach((p, i) => {
    if (!nodeAt.has(`${p[0]},${p[1]}`)) nodeAt.set(`${p[0]},${p[1]}`, i);
  });
  const TOL = 2e-3;
  const nearest = (p) => {
    const hit = nodeAt.get(`${p[0]},${p[1]}`);
    if (hit != null) return hit;
    let best = -1, bd = TOL * TOL;
    nd.forEach((q, i) => {
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d <= bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  const sn = [];
  let unresolved = 0;
  for (let i = 0; i < eA.length; i++) {
    const ia = nearest(eA[i]);
    const ib = nearest(eB[i]);
    if (ia < 0 || ib < 0) unresolved += 1;
    sn.push([ia, ib]);
  }
  const giVals = {
    a: JSON.stringify(eA),
    b: JSON.stringify(eB),
    thickness: JSON.stringify(eT),
    length: JSON.stringify(eL),
    types: JSON.stringify(eK),
    spaces: JSON.stringify(sp),
    areas: JSON.stringify(ar),
    nodes: JSON.stringify(nd),
    nodeTypes: JSON.stringify(nk),
    segNodes: JSON.stringify(sn),
    nodeVals: JSON.stringify(nodeP.vals),
    nodeHas: JSON.stringify(nodeP.have),
    segVals: JSON.stringify(segP.vals),
    segHas: JSON.stringify(segP.have),
    segmentCount: eA.length,
    spaceCount: ar.length,
    nodeCount: nd.length,
    unresolvedEnds: unresolved
  };
  return giVals;
}
export {
  decodeCanvasJson
};

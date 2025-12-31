import { isNumeric } from "./utils.js";

export class Scroll {
    constructor(_main, _sub, options = {}) {
        this._main = _main;
        this._sub = _sub;

        this._id = null;

        this._is_down = false;
        this._is_pause = false;

        this._start = { x: 0, y: 0 };
        this._current = { x: 0, y: 0 };
        this._privious = { x: 0, y: 0 };
        this._transfom = { x: 0, y: 0 };
        this._vel = { x: 0, y: 0 };

        // ✅ 클릭/드래그 임계값(px)
        this._clickThreshold = Number.isFinite(options.clickThreshold) ? options.clickThreshold : 5;

        // ✅ 포인터 이동 기반 상태
        this._downPoint = { x: 0, y: 0 };
        this._movedBeyondClickThreshold = false;

        // ✅ 클릭 1회 차단 플래그(드래그였을 때만)
        this._suppressClick = false;

        // options
        this._mode = options.mode ?? "y"; // 'x' | 'y' | 'xy'
        this._margin = Number.isFinite(options.margin) ? options.margin : 40;
        this._wheelScale = Number.isFinite(options.wheelScale) ? options.wheelScale : 2;

        // Pointer Events
        this._pointerId = null;

        // ✅ 드래그 판정 후에만 pointer capture를 걸기 위한 상태
        this._hasPointerCapture = false;

        // 이벤트 핸들러 보관
        this._handlers = {};

        this.init();
    }

    /* ---------------------------
     * Mode control
     * --------------------------- */
    setMode(mode) {
        if (mode !== "x" && mode !== "y" && mode !== "xy") return;
        this._mode = mode;
        const cur = this.current();
        this.set(cur.x, cur.y);
    }

    mode() {
        return this._mode;
    }

    _allowX() { return this._mode === "x" || this._mode === "xy"; }
    _allowY() { return this._mode === "y" || this._mode === "xy"; }

    /* ---------------------------
     * Init / Destroy
     * --------------------------- */
    init() {
        this.set(0, 0);

        this._main.style.cursor = this._allowX() ? "grab" : this._main.style.cursor;

        this._handlers.pointerdown = (e) => this._onPointerDown(e);
        this._handlers.pointermove = (e) => this._onPointerMove(e);
        this._handlers.pointerup = (e) => this._onPointerUp(e);
        this._handlers.pointercancel = (e) => this._onPointerUp(e);

        this._handlers.wheel = (e) => this._onWheel(e);

        // ✅ 드래그였던 경우에만 click 1회 차단
        this._handlers.clickCapture = (e) => {
            if (this._suppressClick) {
                e.preventDefault();
                e.stopPropagation();
                this._suppressClick = false; // 1회만
            }
        };

        // 캡처 단계로 리스너만 잡고(시작 안정), pointer capture는 "드래그 판정 후"에만 건다
        this._main.addEventListener("pointerdown", this._handlers.pointerdown, { passive: true, capture: true });
        this._main.addEventListener("pointermove", this._handlers.pointermove, { passive: false, capture: true });
        this._main.addEventListener("pointerup", this._handlers.pointerup, { passive: true, capture: true });
        this._main.addEventListener("pointercancel", this._handlers.pointercancel, { passive: true, capture: true });

        this._main.addEventListener("wheel", this._handlers.wheel, { passive: false });

        this._main.addEventListener("click", this._handlers.clickCapture, { capture: true });
    }

    destroy() {
        this.cancel();

        if (!this._main) return;

        this._main.removeEventListener("pointerdown", this._handlers.pointerdown, { capture: true });
        this._main.removeEventListener("pointermove", this._handlers.pointermove, { capture: true });
        this._main.removeEventListener("pointerup", this._handlers.pointerup, { capture: true });
        this._main.removeEventListener("pointercancel", this._handlers.pointercancel, { capture: true });

        this._main.removeEventListener("wheel", this._handlers.wheel);
        this._main.removeEventListener("click", this._handlers.clickCapture, { capture: true });

        this._handlers = {};
    }

    _getPoint(e) {
        return { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    }

    _distFromDown(e) {
        const p = this._getPoint(e);
        const dx = p.x - this._downPoint.x;
        const dy = p.y - this._downPoint.y;
        return Math.hypot(dx, dy);
    }

    /* ---------------------------
     * Public helpers
     * --------------------------- */
    initScroll() {
        this._vel.x = 0;
        this._vel.y = 0;
        this.cancel();
        this.set(0, 0);
    }

    refreshScroll() {
        const cur = this.current();
        this.set(cur.x, cur.y);
    }

    /* ---------------------------
     * Core: current / set / bounds
     * --------------------------- */
    _matrixFromTransform(transformValue) {
        const T = transformValue && transformValue !== "none" ? transformValue : "matrix(1,0,0,1,0,0)";
        const M = window.DOMMatrixReadOnly || window.WebKitCSSMatrix;
        try {
            return new M(T);
        } catch (_) {
            return new M("matrix(1,0,0,1,0,0)");
        }
    }

    current() {
        const transformValue = getComputedStyle(this._sub).getPropertyValue("transform");
        const matrix = this._matrixFromTransform(transformValue);
        const x = Number(matrix.m41);
        const y = Number(matrix.m42);
        return { x: Number.isFinite(x) ? Math.trunc(x) : 0, y: Number.isFinite(y) ? Math.trunc(y) : 0 };
    }

    _bounds() {
        const minX = this._sub.clientWidth * -1 + this._main.clientWidth - this._margin;
        const minY = this._sub.clientHeight * -1 + this._main.clientHeight - this._margin;

        return {
            minX: this._main.clientWidth > this._sub.clientWidth ? 0 : minX,
            minY: this._main.clientHeight > this._sub.clientHeight ? 0 : minY,
        };
    }

    set(_x, _y) {
        const cur = this.current();
        let x = this._allowX() ? _x : cur.x;
        let y = this._allowY() ? _y : cur.y;

        if (this._allowX() && !isNumeric(x)) x = cur.x;
        if (this._allowY() && !isNumeric(y)) y = cur.y;

        x = parseInt(x, 10);
        y = parseInt(y, 10);

        const { minX, minY } = this._bounds();

        if (this._allowX()) {
            x = x >= 0 ? 0 : x <= minX ? minX : x;
            if (this._main.clientWidth > this._sub.clientWidth) x = 0;
        } else {
            x = cur.x;
        }

        if (this._allowY()) {
            y = y >= 0 ? 0 : y <= minY ? minY : y;
            if (this._main.clientHeight > this._sub.clientHeight) y = 0;
        } else {
            y = cur.y;
        }

        this._sub.style.transform = `translate(${x}px, ${y}px)`;
    }

    /* ---------------------------
     * Pointer handlers
     * --------------------------- */
    _onPointerDown(e) {
        if (this._is_pause) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;

        this._is_down = true;
        this._pointerId = e.pointerId;

        // ✅ 초기화
        const p = this._getPoint(e);
        this._downPoint.x = p.x;
        this._downPoint.y = p.y;
        this._movedBeyondClickThreshold = false;

        this._hasPointerCapture = false;

        // 시작 좌표/변환 저장(하지만 아직 스크롤 이동은 하지 않음)
        if (this._allowX()) {
            this._start.x = p.x;
            this._privious.x = this.current().x;
            this._transfom.x = this.current().x;
        }
        if (this._allowY()) {
            this._start.y = p.y;
            this._privious.y = this.current().y;
            this._transfom.y = this.current().y;
        }

        this.cancel();

        // ✅ 여기서 setPointerCapture를 걸면 링크 click 합성이 깨질 수 있으므로 절대 걸지 않음

        if (this._allowX()) this._main.style.cursor = "grabbing";
        this._main.style.userSelect = "none";
        this._main.style.webkitUserSelect = "none";
    }

    _onPointerMove(e) {
        if (!this._is_down || this._is_pause) return;
        if (this._pointerId != null && e.pointerId !== this._pointerId) return;

        // ✅ 임계값 초과 시점에만 드래그로 전환
        if (!this._movedBeyondClickThreshold && this._distFromDown(e) > this._clickThreshold) {
            this._movedBeyondClickThreshold = true;

            // ✅ 드래그로 확정되는 순간에만 pointer capture 적용(이때부터는 링크 클릭이 목적이 아님)
            try {
                this._main.setPointerCapture?.(this._pointerId);
                this._hasPointerCapture = true;
            } catch (_) {
                this._hasPointerCapture = false;
            }
        }

        // ✅ 드래그로 확정된 경우에만 기본동작 억제 + 실제 이동
        if (!this._movedBeyondClickThreshold) return;

        e.stopPropagation();
        e.preventDefault();

        const p = this._getPoint(e);
        const cur = this.current();

        const prevX = cur.x;
        const prevY = cur.y;

        let nx = cur.x;
        let ny = cur.y;

        if (this._allowX()) {
            const dx = p.x - this._start.x;
            nx = this._transfom.x + dx;
        }
        if (this._allowY()) {
            const dy = p.y - this._start.y;
            ny = this._transfom.y + dy;
        }

        this._current.x = nx;
        this._current.y = ny;

        this.set(nx, ny);

        const after = this.current();
        if (this._allowX()) this._vel.x = after.x - prevX;
        if (this._allowY()) this._vel.y = after.y - prevY;
    }

    _onPointerUp(e) {
        if (!this._is_down) return;

        // pointer capture를 잡은 뒤에는 up이 _main으로 오므로 pointerId 체크는 유지
        if (this._pointerId != null && e.pointerId !== this._pointerId) return;

        this._is_down = false;

        if (this._allowX()) this._main.style.cursor = "grab";
        this._main.style.userSelect = "";
        this._main.style.webkitUserSelect = "";

        // ✅ 드래그였으면 클릭 1회 차단
        if (this._movedBeyondClickThreshold) {
            this._suppressClick = true;

            // 관성 시작(실제 이동이 있었던 경우만)
            const cur = this.current();
            const sameX = !this._allowX() || cur.x === this._privious.x;
            const sameY = !this._allowY() || cur.y === this._privious.y;
            if (!(sameX && sameY)) this.begin();
        }

        // capture를 걸었었다면 해제
        if (this._hasPointerCapture) {
            try {
                this._main.releasePointerCapture?.(this._pointerId);
            } catch (_) {}
        }

        this._pointerId = null;
        this._hasPointerCapture = false;
    }

    /* ---------------------------
     * Wheel
     * --------------------------- */
    _onWheel(e) {
        if (this._is_pause) return;

        if (this._allowX()) {
            e.preventDefault();
        }

        this.cancel();

        const cur = this.current();
        let nx = cur.x;
        let ny = cur.y;

        if (this._allowX()) {
            const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
            nx = cur.x - dx / this._wheelScale;
        }
        if (this._allowY()) {
            ny = cur.y - e.deltaY / this._wheelScale;
        }

        this.set(nx, ny);
    }

    /* ---------------------------
     * Inertia loop
     * --------------------------- */
    begin = () => {
        this.cancel();
        this._id = requestAnimationFrame(this.loop);
    };

    cancel = () => {
        if (this._id != null) cancelAnimationFrame(this._id);
        this._id = null;
    };

    loop = () => {
        const cur = this.current();

        let nx = cur.x;
        let ny = cur.y;

        if (this._allowX()) nx = cur.x + this._vel.x;
        if (this._allowY()) ny = cur.y + this._vel.y;

        this.set(nx, ny);

        const { minX, minY } = this._bounds();
        const after = this.current();

        if (this._allowX()) {
            if (after.x > 0) return;
            if (after.x < minX) return;
        }
        if (this._allowY()) {
            if (after.y > 0) return;
            if (after.y < minY) return;
        }

        if (this._allowX()) this._vel.x *= 0.95;
        if (this._allowY()) this._vel.y *= 0.95;

        const stopX = !this._allowX() || Math.abs(this._vel.x) <= 0.7;
        const stopY = !this._allowY() || Math.abs(this._vel.y) <= 0.7;

        if (stopX && stopY) return;

        this._id = requestAnimationFrame(this.loop);
    };

    pause() { this._is_pause = true; }
    resume() { this._is_pause = false; }
}

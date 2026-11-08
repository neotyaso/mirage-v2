import type { CSSProperties } from "react";

/**
 * 三毛猫の受付アバター（SVG）。
 * 体・頭・耳・目・口・前足・しっぽを別レイヤーにしてあり、
 * まばたき・視線・口パク・首かせぎ・耳・手ふり・しっぽを個別に動かせる。
 *
 * 受け取る CSS 変数:
 *   --blink 0..1 / --mouth 0..1 / --gaze-x / --gaze-y / --lean
 *   --ear-l / --ear-r (deg) / --head-x / --head-y / --head-rot
 *   --look-x / --look-y / --squint 0..1 / --happy 0..1
 *   --tongue 0..1 / --paw-angle (deg)
 */
export function CatAvatar() {
  return (
    <svg viewBox="0 0 400 450" style={svgStyle} aria-hidden="true">
      <defs>
        <linearGradient id="catFur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFAF3" />
          <stop offset="1" stopColor="#F3E7D7" />
        </linearGradient>
        <linearGradient id="catLeg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFAF3" stopOpacity="0" />
          <stop offset="0.4" stopColor="#F8EEDF" />
          <stop offset="1" stopColor="#F0E0CC" />
        </linearGradient>
        <clipPath id="catHeadClip">
          <ellipse cx="200" cy="160" rx="112" ry="92" />
        </clipPath>
        <clipPath id="catBodyClip">
          <path d="M200 246 C272 246 304 296 304 352 C304 404 268 426 200 426 C132 426 96 404 96 352 C96 296 128 246 200 246 Z" />
        </clipPath>
      </defs>

      {/* しっぽ（ゆっくり揺れる） */}
      <g style={tail}>
        <path
          d="M296 376 C352 384 366 336 340 318 C322 304 300 318 306 338"
          fill="none"
          stroke="#E8B385"
          strokeWidth="20"
          strokeLinecap="round"
        />
      </g>

      {/* 体 */}
      <g>
        <path
          d="M200 246 C272 246 304 296 304 352 C304 404 268 426 200 426 C132 426 96 404 96 352 C96 296 128 246 200 246 Z"
          fill="url(#catFur)"
          stroke="#EADCCB"
          strokeWidth="2"
        />
        <g clipPath="url(#catBodyClip)">
          <path d="M96 426 C96 350 110 306 138 282 C156 312 150 360 158 426 Z" fill="#E8B385" opacity=".85" />
          <path d="M304 426 C304 356 292 312 268 288 C256 320 264 366 256 426 Z" fill="#B3ACA4" opacity=".45" />
          <ellipse cx="200" cy="360" rx="58" ry="66" fill="#FFFAF3" />
        </g>

        {/* 左の前足（固定） */}
        <g>
          <path
            d="M137 320 C131 348 135 376 139 398 L165 398 C169 376 173 348 167 320 Z"
            fill="url(#catLeg)"
          />
          <ellipse cx="152" cy="410" rx="31" ry="18" fill="#FFFAF3" stroke="#EADCCB" strokeWidth="2" />
          <g stroke="#E4D6C4" strokeWidth="2" strokeLinecap="round">
            <path d="M142 414 V420" />
            <path d="M152 414 V420" />
            <path d="M162 414 V420" />
          </g>
        </g>

        {/* 右の前足。手を振るときは、この足ごと持ち上がる */}
        <g style={rightLeg}>
          <path
            d="M233 320 C227 348 231 376 235 398 L261 398 C265 376 269 348 263 320 Z"
            fill="url(#catLeg)"
          />
          <g style={pawUpright}>
            <ellipse cx="248" cy="410" rx="31" ry="18" fill="#FFFAF3" stroke="#EADCCB" strokeWidth="2" />
            <g style={pawTop} stroke="#E4D6C4" strokeWidth="2" strokeLinecap="round">
              <path d="M238 414 V420" />
              <path d="M248 414 V420" />
              <path d="M258 414 V420" />
            </g>
            <g style={pawPads}>
              <circle cx="238" cy="398" r="4" fill="#F2C4B8" />
              <circle cx="248" cy="394" r="4.4" fill="#F2C4B8" />
              <circle cx="258" cy="398" r="4" fill="#F2C4B8" />
              <ellipse cx="248" cy="408" rx="8" ry="6" fill="#F2C4B8" />
            </g>
          </g>
        </g>
      </g>

      {/* 首輪 */}
      <path d="M150 250 Q200 272 250 250 L252 266 Q200 290 148 266 Z" fill="#B7D0D8" />
      <circle cx="200" cy="278" r="10" fill="#EFD9A7" stroke="#D8BE86" strokeWidth="2" />
      <circle cx="200" cy="278" r="3" fill="#B99A5C" />

      {/* 頭（首を支点に少し傾く） */}
      <g style={head}>
        {/* 耳 */}
        <g style={earLeft}>
          <path d="M112 128 L100 40 Q98 26 112 34 L158 84 Z" fill="#E8B385" stroke="#D99C6D" strokeWidth="2" />
          <path d="M118 112 L110 54 Q109 44 118 50 L148 84 Z" fill="#F2C4B8" />
        </g>
        <g style={earRight}>
          <path d="M288 128 L300 40 Q302 26 288 34 L242 84 Z" fill="#B3ACA4" stroke="#9C948B" strokeWidth="2" />
          <path d="M282 112 L290 54 Q291 44 282 50 L252 84 Z" fill="#F2C4B8" />
        </g>

        {/* 顔のベース */}
        <ellipse cx="200" cy="160" rx="112" ry="92" fill="url(#catFur)" stroke="#EADCCB" strokeWidth="2.5" />

        {/* 三毛のまだら */}
        <g clipPath="url(#catHeadClip)">
          <path
            d="M58 128 C64 94 100 74 140 82 C164 88 174 106 166 126 C158 146 170 164 160 182 C146 198 110 196 88 178 C70 164 56 148 58 128 Z"
            fill="#E8B385"
          />
          <path
            d="M188 68 C238 62 292 86 302 130 C310 166 288 190 262 188 C238 186 226 160 210 142 C198 128 186 100 188 68 Z"
            fill="#B3ACA4"
          />
          <path d="M248 92 C260 104 266 118 268 132" stroke="#958D85" strokeWidth="6" strokeLinecap="round" fill="none" />
          <path d="M236 104 C248 116 254 130 256 144" stroke="#958D85" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M274 128 C280 140 282 152 280 164" stroke="#958D85" strokeWidth="5" strokeLinecap="round" fill="none" />
          <ellipse cx="200" cy="250" rx="100" ry="26" fill="#E6D9C8" opacity=".35" />
        </g>

        {/* ほおの毛 */}
        <path d="M92 176 L74 184 L94 194 Z" fill="#FFFAF3" stroke="#EADCCB" strokeWidth="1.5" />
        <path d="M308 176 L326 184 L306 194 Z" fill="#FFFAF3" stroke="#EADCCB" strokeWidth="1.5" />

        {/* 目（--blink で閉じる / --squint で細くなる） */}
        <g style={roundEyes}>
          <g style={blink}>
            <ellipse cx="162" cy="166" rx="14" ry="18" fill="#4B4A55" />
            <ellipse cx="238" cy="166" rx="14" ry="18" fill="#4B4A55" />
            <g style={gaze}>
              <circle cx="157" cy="159" r="4.5" fill="#FFFFFF" opacity=".92" />
              <circle cx="233" cy="159" r="4.5" fill="#FFFFFF" opacity=".92" />
              <circle cx="168" cy="175" r="2" fill="#FFFFFF" opacity=".4" />
              <circle cx="244" cy="175" r="2" fill="#FFFFFF" opacity=".4" />
            </g>
          </g>
        </g>

        {/* うれしい目（--happy で出る） */}
        <g style={happyEyes} stroke="#4B4A55" strokeWidth="5" strokeLinecap="round" fill="none">
          <path d="M148 172 Q162 155 176 172" />
          <path d="M224 172 Q238 155 252 172" />
        </g>

        {/* 頬の赤み */}
        <ellipse cx="128" cy="212" rx="17" ry="10" fill="#F2C4B8" opacity=".5" />
        <ellipse cx="272" cy="212" rx="17" ry="10" fill="#F2C4B8" opacity=".5" />

        {/* 口まわり */}
        <ellipse cx="182" cy="212" rx="27" ry="22" fill="#FFFAF3" />
        <ellipse cx="218" cy="212" rx="27" ry="22" fill="#FFFAF3" />
        <path d="M191 200 Q200 193 209 200 Q200 211 191 200 Z" fill="#E9A9A2" />

        {/* 開いた口（鼻のすぐ下） */}
        <g style={mouth}>
          <ellipse cx="200" cy="219" rx="9" ry="7" fill="#6B4747" />
          <ellipse cx="200" cy="223" rx="5" ry="2.5" fill="#E9A6A6" />
        </g>

        {/* ω口（開口時はフェード） */}
        <path
          d="M187 216 Q194 226 200 217 Q206 226 213 216"
          fill="none"
          stroke="#7A5A5A"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ opacity: "calc(1 - var(--mouth, 0) * 3)" }}
        />

        {/* 毛繕いの舌 */}
        <g style={tongue}>
          <path d="M194 219 Q200 230 206 219 Z" fill="#E9A6A6" />
        </g>

        {/* ひげ */}
        <g stroke="#D8CBBA" strokeWidth="2.2" strokeLinecap="round" fill="none">
          <path d="M152 206 C126 198 104 196 86 198" />
          <path d="M151 216 C122 216 98 219 78 225" />
          <path d="M153 226 C128 233 110 242 96 253" />
          <path d="M248 206 C274 198 296 196 314 198" />
          <path d="M249 216 C278 216 302 219 322 225" />
          <path d="M247 226 C272 233 290 242 304 253" />
        </g>
      </g>
    </svg>
  );
}

const svgStyle: CSSProperties = {
  height: "100%",
  width: "auto",
  overflow: "visible",
};

// 頭: 首を支点に、体より少し大きく傾く
const head: CSSProperties = {
  transform:
    "translate(calc(var(--gaze-x, 0px) * 1.1 + var(--head-x, 0px)), calc(var(--gaze-y, 0px) * 1.1 + var(--head-y, 0px))) rotate(calc(var(--lean, 0deg) * 1.8 + var(--head-rot, 0deg)))",
  transformOrigin: "200px 258px",
  transformBox: "view-box",
};

const earLeft: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "130px 110px",
  transform: "rotate(var(--ear-l, 0deg))",
};

const earRight: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "270px 110px",
  transform: "rotate(var(--ear-r, 0deg))",
};

// まばたき（--blink）と細目（--squint）をまとめる
const blink: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "200px 166px",
  transform: "scaleY(calc((1 - var(--blink, 0)) * (1 - var(--squint, 0) * 0.75)))",
};

// 視線: ハイライトを動かす
const gaze: CSSProperties = {
  transform:
    "translate(calc(var(--gaze-x, 0px) * 1.1 + var(--look-x, 0px)), calc(var(--gaze-y, 0px) * 1.1 + var(--look-y, 0px)))",
};

// 目全体（--happy で消して、うれしい目に切り替える）
const roundEyes: CSSProperties = {
  opacity: "calc(1 - var(--happy, 0))",
};

const happyEyes: CSSProperties = {
  opacity: "var(--happy, 0)",
};

// 口: 0=閉じる / 1=大きく開く
const mouth: CSSProperties = {
  transformBox: "fill-box",
  transformOrigin: "center",
  transform: "scaleY(calc(0.08 + 1.1 * var(--mouth, 0)))",
};

const tongue: CSSProperties = {
  opacity: "var(--tongue, 0)",
  transformBox: "fill-box",
  transformOrigin: "top center",
  transform: "scaleY(calc(0.4 + var(--tongue, 0) * 0.8))",
};

// しっぽ: 揺れに合わせてゆっくり振る
const tail: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "296px 378px",
  transform: "rotate(calc(var(--sway, 0deg) * 2.2))",
};

// 右前足: 肩を支点に持ち上がる
const rightLeg: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "248px 322px",
  transform: "rotate(var(--paw-angle, 0deg))",
};

// 肉球は腕の回転を打ち消して、いつも正面を向く
const pawUpright: CSSProperties = {
  transformBox: "view-box",
  transformOrigin: "248px 410px",
  transform: "rotate(calc(var(--paw-angle, 0deg) * -1))",
};

const pawTop: CSSProperties = {
  opacity: "calc(1 - var(--paw-show, 0))",
};

const pawPads: CSSProperties = {
  opacity: "var(--paw-show, 0)",
};

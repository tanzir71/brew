// Brew 21:600, translated from Figma NcqNdBhgeg6om2CCZwrYV8.
const imgIcon = './assets/figma/938df8eae30925b7.svg';
const imgIcon1 = './assets/figma/e8c5b10f8a665e98.svg';

export default function SectionStart() {
  return (
    <div
      className="content-stretch flex flex-col items-center py-[160px] relative size-full"
      data-node-id="21:600"
      data-name="Section · Start"
    >
      <p
        className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-normal leading-[48px] relative shrink-0 text-[44px] text-[color:var(--brew-text-primary)] text-center tracking-[-0.88px] w-[900px]"
        data-node-id="21:601"
      >
        Start reading in ten seconds.
      </p>
      <div className="h-[16px] relative shrink-0 w-[10px]" data-node-id="21:602" data-name="Gap" />
      <p
        className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[22px] relative shrink-0 text-[15px] text-[color:var(--brew-text-soft)] text-center w-[560px]"
        data-node-id="21:603"
        style={{ fontVariationSettings: '"wdth" 100' }}
      >
        Open the demo, or run Brew right here in your browser. No sign-up.
      </p>
      <div className="h-[32px] relative shrink-0 w-[10px]" data-node-id="21:604" data-name="Gap" />
      <div
        className="content-stretch flex gap-[10px] items-start overflow-clip relative shrink-0"
        data-node-id="21:605"
        data-name="Frame"
      >
        <div
          className="bg-[var(--brew-text-primary)] content-stretch flex gap-[6px] h-[36px] items-center justify-center px-[14px] relative rounded-[8px] shrink-0"
          data-node-id="21:606"
          data-name="Button/Try the live demo"
        >
          <div
            className="relative shrink-0 size-[16px]"
            data-node-id="I21:606;6:4"
            data-name="Icon"
          >
            <img alt="" className="figma-asset" src={imgIcon} />
          </div>
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-inverse)] whitespace-nowrap"
            data-node-id="I21:606;6:6"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Try the live demo
          </p>
        </div>
        <div
          className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-strong)] border-solid content-stretch flex gap-[6px] h-[36px] items-center justify-center px-[14px] relative rounded-[8px] shrink-0"
          data-node-id="21:612"
          data-name="Button/Start in this browser"
        >
          <div
            className="relative shrink-0 size-[16px]"
            data-node-id="I21:612;6:12"
            data-name="Icon"
          >
            <img alt="" className="figma-asset" src={imgIcon1} />
          </div>
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
            data-node-id="I21:612;6:14"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Start in this browser
          </p>
        </div>
      </div>
    </div>
  );
}

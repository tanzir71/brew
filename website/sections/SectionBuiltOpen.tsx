// Brew 21:569, translated from Figma NcqNdBhgeg6om2CCZwrYV8.
const imgIconCode = './assets/figma/beafe0796bb13148.svg';
const imgIconShield = './assets/figma/53a468c166568607.svg';
const imgIconDownload = './assets/figma/bcae9029a4f64c1b.svg';

export default function SectionBuiltOpen() {
  return (
    <div
      className="content-stretch flex gap-[24px] items-start pt-[160px] relative size-full"
      data-node-id="21:569"
      data-name="Section · Built open"
    >
      <div
        className="border border-[var(--brew-border-default)] border-solid content-stretch flex flex-[1_0_0] flex-col gap-[14px] items-start min-w-px overflow-clip p-[28px] relative rounded-[18px]"
        data-node-id="21:570"
        data-name="Frame"
      >
        <div className="relative shrink-0 size-[22px]" data-node-id="21:571" data-name="Icon/code">
          <img alt="" className="figma-asset" src={imgIconCode} />
        </div>
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] min-w-full relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-[min-content]"
          data-node-id="21:573"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          Open source
        </p>
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-full relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[min-content]"
          data-node-id="21:574"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          The code, the issues and the roadmap live on GitHub. Fork it, read it, or send a fix.
        </p>
      </div>
      <div
        className="border border-[var(--brew-border-default)] border-solid content-stretch flex flex-[1_0_0] flex-col gap-[14px] items-start min-w-px overflow-clip p-[28px] relative rounded-[18px]"
        data-node-id="21:575"
        data-name="Frame"
      >
        <div
          className="relative shrink-0 size-[22px]"
          data-node-id="21:576"
          data-name="Icon/shield"
        >
          <img alt="" className="figma-asset" src={imgIconShield} />
        </div>
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] min-w-full relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-[min-content]"
          data-node-id="21:578"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          Private by design
        </p>
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-full relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[min-content]"
          data-node-id="21:579"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          There is no Brew server, so there is nothing that could see what you read.
        </p>
      </div>
      <div
        className="border border-[var(--brew-border-default)] border-solid content-stretch flex flex-[1_0_0] flex-col gap-[14px] items-start min-w-px overflow-clip p-[28px] relative rounded-[18px]"
        data-node-id="21:580"
        data-name="Frame"
      >
        <div
          className="relative shrink-0 size-[22px]"
          data-node-id="21:581"
          data-name="Icon/download"
        >
          <img alt="" className="figma-asset" src={imgIconDownload} />
        </div>
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] min-w-full relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-[min-content]"
          data-node-id="21:583"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          Yours to leave
        </p>
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-full relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[min-content]"
          data-node-id="21:584"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          OPML, Markdown, JSON or a single .brew file, whenever you like.
        </p>
      </div>
    </div>
  );
}

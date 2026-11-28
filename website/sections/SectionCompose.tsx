// Brew 19:283, translated from Figma NcqNdBhgeg6om2CCZwrYV8.
const imgStateOn = './assets/figma/eeec80cc6a8fb3f9.svg';
const imgIconChevronDown = './assets/figma/354a9be3db6547c4.svg';
const imgIconArrowDown = './assets/figma/744bb62d05f5ad28.svg';
const imgIconArrowUp = './assets/figma/b6997eb5b4fbfa8b.svg';
const imgIconCheck = './assets/figma/6b81d0904bfbd751.svg';
const imgLead = './assets/figma/a3164d8aff1594bb.svg';
const imgImage = './assets/figma/f16e8deb4b098d63.svg';
const imgImage1 = './assets/figma/761907a116e9689c.svg';
const imgIconSparkle = './assets/figma/86638de70e8f6ded.svg';
const imgIconGrip = './assets/figma/925bb0644f74c1c9.svg';
const imgIconFolder = './assets/figma/ff807e4fe7fb5a94.svg';
const imgIconChevronDown1 = './assets/figma/1f7e27ab42890ed8.svg';
const imgIconChevronDown2 = './assets/figma/6ffd0ba83cb12b60.svg';

type ToggleProps = {
  className?: string;
  state?: 'on';
};

function Toggle({ className }: ToggleProps) {
  return (
    <div className={className || 'h-[18px] relative w-[32px]'} data-node-id="6:54">
      <img alt="" className="figma-asset" src={imgStateOn} />
    </div>
  );
}

type SegmentProps = {
  className?: string;
  label?: string;
  state?: 'selected' | 'default';
};

function Segment({ className, label = 'Segment', state = 'selected' }: SegmentProps) {
  const isDefault = state === 'default';
  return (
    <div
      className={
        className ||
        `content-stretch flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] ${isDefault ? '' : String.raw`bg-[var(--brew-bg-surface)] drop-shadow-[0px_0px_0px_rgba(27,24,21,0.04),0px_1px_1px_rgba(27,24,21,0.06)]`}`
      }
      id={isDefault ? 'node-6_61' : 'node-6_59'}
    >
      {state === 'selected' && (
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
          data-node-id="6:60"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          {label}
        </p>
      )}
      {isDefault && (
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
          data-node-id="6:62"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          {label}
        </p>
      )}
    </div>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <div
      className={className || 'relative size-[20px]'}
      data-node-id="5:68"
      data-name="Icon/chevron-down"
    >
      <img alt="" className="figma-asset" src={imgIconChevronDown} />
    </div>
  );
}

function IconArrowDown({ className }: { className?: string }) {
  return (
    <div
      className={className || 'relative size-[20px]'}
      data-node-id="5:123"
      data-name="Icon/arrow-down"
    >
      <img alt="" className="figma-asset" src={imgIconArrowDown} />
    </div>
  );
}

function IconArrowUp({ className }: { className?: string }) {
  return (
    <div
      className={className || 'relative size-[20px]'}
      data-node-id="5:120"
      data-name="Icon/arrow-up"
    >
      <img alt="" className="figma-asset" src={imgIconArrowUp} />
    </div>
  );
}

export default function SectionCompose() {
  return (
    <div
      className="content-stretch flex gap-[80px] items-center pt-[160px] px-[120px] relative size-full"
      data-node-id="19:283"
      data-name="Section · Compose"
    >
      <div
        className="content-stretch flex flex-col items-start overflow-clip relative shrink-0 w-[440px]"
        data-node-id="19:284"
        data-name="Copy"
      >
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
          data-node-id="19:285"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          Compose
        </p>
        <div
          className="h-[14px] relative shrink-0 w-[10px]"
          data-node-id="19:286"
          data-name="Gap"
        />
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-normal leading-[48px] min-w-full relative shrink-0 text-[44px] text-[color:var(--brew-text-primary)] tracking-[-0.88px] w-[min-content]"
          data-node-id="19:287"
        >
          Decide how much you read before you start.
        </p>
        <div
          className="h-[18px] relative shrink-0 w-[10px]"
          data-node-id="19:288"
          data-name="Gap"
        />
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[22px] min-w-full relative shrink-0 text-[15px] text-[color:var(--brew-text-soft)] w-[min-content]"
          data-node-id="19:289"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          Each section of a Brew has its own sources, layout, length and filter. The preview beside
          it is tomorrow’s issue, built from today’s articles.
        </p>
        <div
          className="h-[28px] relative shrink-0 w-[10px]"
          data-node-id="19:290"
          data-name="Gap"
        />
        <div
          className="content-stretch flex flex-col gap-[12px] items-start overflow-clip relative shrink-0 w-full"
          data-node-id="19:291"
          data-name="Frame"
        >
          <div
            className="content-stretch flex gap-[10px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:292"
            data-name="Frame"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="19:293"
              data-name="Icon/check"
            >
              <img alt="" className="figma-asset" src={imgIconCheck} />
            </div>
            <p
              className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
              data-node-id="19:295"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Four layouts, from a lead story to plain headlines
            </p>
          </div>
          <div
            className="content-stretch flex gap-[10px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:296"
            data-name="Frame"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="19:297"
              data-name="Icon/check"
            >
              <img alt="" className="figma-asset" src={imgIconCheck} />
            </div>
            <p
              className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
              data-node-id="19:299"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Title, excerpt, full text or a short brief
            </p>
          </div>
          <div
            className="content-stretch flex gap-[10px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:300"
            data-name="Frame"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="19:301"
              data-name="Icon/check"
            >
              <img alt="" className="figma-asset" src={imgIconCheck} />
            </div>
            <p
              className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
              data-node-id="19:303"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Filters that read like sentences
            </p>
          </div>
          <div
            className="content-stretch flex gap-[10px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:304"
            data-name="Frame"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="19:305"
              data-name="Icon/check"
            >
              <img alt="" className="figma-asset" src={imgIconCheck} />
            </div>
            <p
              className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
              data-node-id="19:307"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Weekdays, weekly or monthly, in your time zone
            </p>
          </div>
        </div>
      </div>
      <div
        className="bg-[var(--brew-bg-subtle)] h-[580px] overflow-clip relative rounded-[24px] shrink-0 w-[640px]"
        data-node-id="19:308"
        data-name="Stage"
      >
        <div
          className="absolute bg-[var(--brew-bg-surface)] border-[0.72px] border-[var(--brew-border-default)] border-solid content-stretch flex flex-col h-[678.24px] items-start left-[250px] overflow-clip pt-[25.92px] px-[25.92px] rounded-[8.64px] shadow-[0px_28px_64px_0px_rgba(27,24,21,0.18),0px_4px_12px_0px_rgba(27,24,21,0.06)] top-[56px] w-[403.2px]"
          data-node-id="19:540"
          data-name="Paper (rendered preview)"
        >
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[11.52px] relative shrink-0 text-[8.64px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
            data-node-id="19:541"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Thursday, 26 November · No. 215
          </p>
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-normal leading-[25.92px] relative shrink-0 text-[21.6px] text-[color:var(--brew-text-primary)] tracking-[-0.324px] whitespace-nowrap"
            data-node-id="19:542"
          >
            Morning
          </p>
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-normal leading-[15.84px] relative shrink-0 text-[10.8px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
            data-node-id="19:543"
          >
            Seventeen stories, about eighteen minutes.
          </p>
          <div
            className="h-[12.96px] relative shrink-0 w-[7.2px]"
            data-node-id="19:544"
            data-name="Frame"
          />
          <div
            className="bg-[var(--brew-border-strong)] h-[0.72px] relative shrink-0 w-full"
            data-node-id="19:545"
            data-name="Rule"
          />
          <div
            className="border-[1.08px] border-[var(--brew-accent-default)] border-solid content-stretch flex flex-col gap-[7.2px] items-start overflow-clip p-[7.2px] relative rounded-[7.2px] shrink-0 w-full"
            data-node-id="19:546"
            data-name="Editing highlight"
          >
            <div
              className="content-stretch flex gap-[5.76px] items-center overflow-clip pt-[5.76px] relative shrink-0 w-full"
              data-node-id="19:547"
              data-name="Frame"
            >
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-medium leading-[17.28px] relative shrink-0 text-[12.96px] text-[color:var(--brew-text-primary)] tracking-[-0.0648px] whitespace-nowrap"
                data-node-id="19:548"
              >{`Design & craft`}</p>
              <div
                className="flex-[1_0_0] h-[0.72px] min-w-px relative"
                data-node-id="19:549"
                data-name="Spacer"
              />
              <div
                className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[3.6px] h-[15.84px] items-center pl-[5.04px] pr-[5.76px] relative rounded-[719.28px] shrink-0"
                data-node-id="19:550"
                data-name="Badge"
              >
                <div
                  className="relative shrink-0 size-[4.32px]"
                  data-node-id="I19:550;6:51"
                  data-name="Lead"
                >
                  <img alt="" className="figma-asset" src={imgLead} />
                </div>
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[11.52px] relative shrink-0 text-[8.64px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                  data-node-id="I19:550;6:52"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Editing
                </p>
              </div>
            </div>
            <div
              className="h-[136.8px] relative shrink-0 w-[336.96px]"
              data-node-id="19:551"
              data-name="Image"
            >
              <img alt="" className="figma-asset" src={imgImage} />
            </div>
            <div
              className="content-stretch flex gap-[4.32px] items-center overflow-clip relative shrink-0"
              data-node-id="19:554"
              data-name="Frame"
            >
              <div
                className="bg-[var(--brew-art-2)] content-stretch flex items-center justify-center relative rounded-[4.32px] shrink-0 size-[17.28px]"
                data-node-id="19:555"
                data-name="Avatar"
              >
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[11.52px] relative shrink-0 text-[8.64px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
                  data-node-id="I19:555;6:85"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Q
                </p>
              </div>
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[11.52px] relative shrink-0 text-[8.64px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
                data-node-id="19:556"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Quiet Systems · 6 min
              </p>
            </div>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-medium leading-[20.16px] min-w-full relative shrink-0 text-[15.84px] text-[color:var(--brew-text-primary)] tracking-[-0.1584px] w-[min-content]"
              data-node-id="19:557"
            >
              The quiet structure behind interfaces that feel inevitable
            </p>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[13.68px] min-w-full relative shrink-0 text-[9.36px] text-[color:var(--brew-text-soft)] w-[min-content]"
              data-node-id="19:558"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Good products rarely announce their structure. They make the next move obvious.
            </p>
            <div
              className="border-[var(--brew-border-default)] border-solid border-t-[0.72px] content-stretch flex gap-[10.08px] items-center overflow-clip py-[7.2px] relative shrink-0 w-full"
              data-node-id="19:559"
              data-name="Frame"
            >
              <div
                className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2.88px] items-start min-w-px overflow-clip relative"
                data-node-id="19:560"
                data-name="Frame"
              >
                <p
                  className="font-[family-name:var(--brew-font-reading)] font-medium leading-[17.28px] min-w-full relative shrink-0 text-[12.96px] text-[color:var(--brew-text-primary)] tracking-[-0.0648px] w-[min-content]"
                  data-node-id="19:561"
                >
                  Why the best local-first apps still ship a server
                </p>
                <p
                  className="font-[family-name:var(--brew-font-ui)] font-normal leading-[11.52px] relative shrink-0 text-[8.64px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
                  data-node-id="19:562"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Small Tools Journal · 5 min
                </p>
              </div>
              <div
                className="bg-[var(--brew-art-3)] h-[41.76px] overflow-clip relative rounded-[4.32px] shrink-0 w-[60.48px]"
                data-node-id="19:563"
                data-name="Image"
              >
                <div
                  className="absolute bg-[var(--brew-art-4)] h-[1.462px] left-0 opacity-30 top-[6.68px] w-[60.48px]"
                  data-node-id="19:564"
                  data-name="Rectangle"
                />
                <div
                  className="absolute bg-[var(--brew-art-4)] h-[1.462px] left-0 opacity-40 top-[11.28px] w-[60.48px]"
                  data-node-id="19:565"
                  data-name="Rectangle"
                />
                <div
                  className="absolute bg-[var(--brew-art-4)] h-[1.462px] left-0 opacity-50 top-[15.87px] w-[60.48px]"
                  data-node-id="19:566"
                  data-name="Rectangle"
                />
                <div
                  className="absolute bg-[var(--brew-art-4)] h-[1.462px] left-0 opacity-60 top-[20.46px] w-[60.48px]"
                  data-node-id="19:567"
                  data-name="Rectangle"
                />
                <div
                  className="absolute bg-[var(--brew-art-4)] h-[1.462px] left-0 opacity-70 top-[25.06px] w-[60.48px]"
                  data-node-id="19:568"
                  data-name="Rectangle"
                />
                <div
                  className="absolute bg-[var(--brew-art-4)] h-[1.462px] left-0 opacity-80 top-[29.65px] w-[60.48px]"
                  data-node-id="19:569"
                  data-name="Rectangle"
                />
                <div
                  className="absolute bg-[var(--brew-art-4)] h-[1.462px] left-0 opacity-90 top-[34.24px] w-[60.48px]"
                  data-node-id="19:570"
                  data-name="Rectangle"
                />
              </div>
            </div>
            <div
              className="border-[var(--brew-border-default)] border-solid border-t-[0.72px] content-stretch flex gap-[10.08px] items-center overflow-clip py-[7.2px] relative shrink-0 w-full"
              data-node-id="19:571"
              data-name="Frame"
            >
              <div
                className="[word-break:break-word] content-stretch flex flex-[1_0_0] flex-col gap-[2.88px] items-start min-w-px overflow-clip relative"
                data-node-id="19:572"
                data-name="Frame"
              >
                <p
                  className="font-[family-name:var(--brew-font-reading)] font-medium leading-[17.28px] min-w-full relative shrink-0 text-[12.96px] text-[color:var(--brew-text-primary)] tracking-[-0.0648px] w-[min-content]"
                  data-node-id="19:573"
                >
                  Figma’s variables panel, a month in
                </p>
                <p
                  className="font-[family-name:var(--brew-font-ui)] font-normal leading-[11.52px] relative shrink-0 text-[8.64px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
                  data-node-id="19:574"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Interface Letters · 7 min
                </p>
              </div>
              <div
                className="h-[41.76px] relative shrink-0 w-[60.48px]"
                data-node-id="19:575"
                data-name="Image"
              >
                <img alt="" className="figma-asset" src={imgImage1} />
              </div>
            </div>
          </div>
          <div
            className="content-stretch flex items-center overflow-clip pb-[8.64px] pt-[15.84px] relative shrink-0 w-full"
            data-node-id="19:578"
            data-name="Frame"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-medium leading-[17.28px] relative shrink-0 text-[12.96px] text-[color:var(--brew-text-primary)] tracking-[-0.0648px] whitespace-nowrap"
              data-node-id="19:579"
            >
              From your newsletters
            </p>
          </div>
          <div
            className="bg-[var(--brew-bg-canvas)] border-[0.72px] border-[var(--brew-border-default)] border-solid content-stretch flex flex-col gap-[4.32px] items-start overflow-clip p-[10.08px] relative rounded-[7.2px] shrink-0 w-full"
            data-node-id="19:580"
            data-name="Frame"
          >
            <div
              className="content-stretch flex gap-[4.32px] items-center overflow-clip relative shrink-0"
              data-node-id="19:581"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[9.36px]"
                data-node-id="19:582"
                data-name="Icon/sparkle"
              >
                <img alt="" className="figma-asset" src={imgIconSparkle} />
              </div>
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[11.52px] relative shrink-0 text-[8.64px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
                data-node-id="19:583"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Brief · 3 letters
              </p>
            </div>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[13.68px] min-w-full relative shrink-0 text-[9.36px] text-[color:var(--brew-text-soft)] w-[min-content]"
              data-node-id="19:584"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Three letters this morning circled the same idea: browsers are starting to let sites
              declare tools for agents.
            </p>
          </div>
        </div>
        <div
          className="absolute bg-[var(--brew-bg-surface)] border border-[var(--brew-border-strong)] border-solid content-stretch flex flex-col gap-[14px] items-start left-[36px] overflow-clip p-[16px] rounded-[12px] shadow-[0px_28px_64px_0px_rgba(27,24,21,0.18),0px_4px_12px_0px_rgba(27,24,21,0.06)] top-[110px] w-[411px]"
          data-node-id="19:585"
          data-name="Section card (expanded) · Design & craft"
        >
          <div
            className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:586"
            data-name="Card header"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="19:587"
              data-name="Icon/grip"
            >
              <img alt="" className="figma-asset" src={imgIconGrip} />
            </div>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
              data-node-id="19:588"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >{`Design & craft`}</p>
            <div
              className="flex-[1_0_0] h-px min-w-px relative"
              data-node-id="19:589"
              data-name="Spacer"
            />
            <div
              className="content-stretch flex items-start overflow-clip p-[5px] relative rounded-[6px] shrink-0"
              data-node-id="19:590"
              data-name="IconButton/Move up"
            >
              <IconArrowUp className="relative shrink-0 size-[15px]" />
            </div>
            <div
              className="content-stretch flex items-start overflow-clip p-[5px] relative rounded-[6px] shrink-0"
              data-node-id="19:592"
              data-name="IconButton/Move down"
            >
              <IconArrowDown className="relative shrink-0 size-[15px]" />
            </div>
            <div
              className="content-stretch flex items-start overflow-clip p-[5px] relative rounded-[6px] shrink-0"
              data-node-id="19:594"
              data-name="IconButton/Collapse"
            >
              <IconChevronDown className="relative shrink-0 size-[15px]" />
            </div>
          </div>
          <div
            className="content-stretch flex gap-[12px] items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:596"
            data-name="Field/From"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[76px]"
              data-node-id="19:597"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              From
            </p>
            <div
              className="content-stretch flex gap-[6px] items-center overflow-clip relative shrink-0"
              data-node-id="19:598"
              data-name="Frame"
            >
              <div
                className="bg-[var(--brew-bg-subtle)] content-stretch flex gap-[6px] h-[24px] items-center pl-[7px] pr-[9px] relative rounded-[6px] shrink-0"
                data-node-id="19:599"
                data-name="Chip/Design"
              >
                <div
                  className="relative shrink-0 size-[14px]"
                  data-node-id="I19:599;6:97"
                  data-name="Icon/folder"
                >
                  <img alt="" className="figma-asset" src={imgIconFolder} />
                </div>
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
                  data-node-id="I19:599;6:99"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Design
                </p>
              </div>
              <div
                className="bg-[var(--brew-bg-subtle)] content-stretch flex gap-[6px] h-[24px] items-center pl-[7px] pr-[9px] relative rounded-[6px] shrink-0"
                data-node-id="19:600"
                data-name="Chip/Independent"
              >
                <div
                  className="relative shrink-0 size-[14px]"
                  data-node-id="I19:600;6:97"
                  data-name="Icon/folder"
                >
                  <img alt="" className="figma-asset" src={imgIconFolder} />
                </div>
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
                  data-node-id="I19:600;6:99"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Independent
                </p>
              </div>
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                data-node-id="19:601"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                + Source
              </p>
            </div>
          </div>
          <div
            className="content-stretch flex gap-[12px] items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:602"
            data-name="Field/Layout"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[76px]"
              data-node-id="19:603"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Layout
            </p>
            <div
              className="bg-[var(--brew-bg-subtle)] content-stretch flex gap-[2px] items-start overflow-clip p-[2px] relative rounded-[8px] shrink-0"
              data-node-id="19:604"
              data-name="Segmented"
            >
              <Segment
                className="bg-[var(--brew-bg-surface)] content-stretch drop-shadow-[0px_0px_0px_rgba(27,24,21,0.04),0px_1px_1px_rgba(27,24,21,0.06)] flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Lead"
              />
              <Segment
                className="content-stretch flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Magazine"
                state="default"
              />
              <Segment
                className="content-stretch flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Grid"
                state="default"
              />
              <Segment
                className="content-stretch flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Headlines"
                state="default"
              />
            </div>
          </div>
          <div
            className="content-stretch flex gap-[12px] items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:609"
            data-name="Field/Items"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[76px]"
              data-node-id="19:610"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Items
            </p>
            <div
              className="content-stretch flex gap-[10px] items-center overflow-clip relative shrink-0"
              data-node-id="19:611"
              data-name="Frame"
            >
              <div
                className="border border-[var(--brew-border-strong)] border-solid content-stretch flex h-[30px] items-center overflow-clip relative rounded-[8px] shrink-0"
                data-node-id="19:612"
                data-name="Stepper"
              >
                <div
                  className="content-stretch flex h-[30px] items-center justify-center overflow-clip px-[11px] relative shrink-0"
                  data-node-id="19:613"
                  data-name="Frame"
                >
                  <p
                    className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
                    data-node-id="19:614"
                    style={{ fontVariationSettings: '"wdth" 100' }}
                  >
                    −
                  </p>
                </div>
                <div
                  className="content-stretch flex h-[30px] items-center justify-center overflow-clip px-[11px] relative shrink-0"
                  data-node-id="19:615"
                  data-name="Frame"
                >
                  <p
                    className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
                    data-node-id="19:616"
                    style={{ fontVariationSettings: '"wdth" 100' }}
                  >
                    4
                  </p>
                </div>
                <div
                  className="content-stretch flex h-[30px] items-center justify-center overflow-clip px-[11px] relative shrink-0"
                  data-node-id="19:617"
                  data-name="Frame"
                >
                  <p
                    className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
                    data-node-id="19:618"
                    style={{ fontVariationSettings: '"wdth" 100' }}
                  >
                    +
                  </p>
                </div>
              </div>
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
                data-node-id="19:619"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                at most
              </p>
            </div>
          </div>
          <div
            className="content-stretch flex gap-[12px] items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:620"
            data-name="Field/Show"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[76px]"
              data-node-id="19:621"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Show
            </p>
            <div
              className="bg-[var(--brew-bg-subtle)] content-stretch flex gap-[2px] items-start overflow-clip p-[2px] relative rounded-[8px] shrink-0"
              data-node-id="19:622"
              data-name="Segmented"
            >
              <Segment
                className="content-stretch flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Title"
                state="default"
              />
              <Segment
                className="bg-[var(--brew-bg-surface)] content-stretch drop-shadow-[0px_0px_0px_rgba(27,24,21,0.04),0px_1px_1px_rgba(27,24,21,0.06)] flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Excerpt"
              />
              <Segment
                className="content-stretch flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Full text"
                state="default"
              />
              <Segment
                className="content-stretch flex h-[28px] items-center justify-center px-[12px] relative rounded-[6px] shrink-0"
                label="Brief"
                state="default"
              />
            </div>
          </div>
          <div
            className="content-stretch flex gap-[12px] items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:627"
            data-name="Field/Options"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[76px]"
              data-node-id="19:628"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Options
            </p>
            <div
              className="content-stretch flex gap-[18px] items-center overflow-clip relative shrink-0"
              data-node-id="19:629"
              data-name="Frame"
            >
              <div
                className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0"
                data-node-id="19:630"
                data-name="Frame"
              >
                <Toggle className="h-[18px] relative shrink-0 w-[32px]" />
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
                  data-node-id="19:632"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Images
                </p>
              </div>
              <div
                className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0"
                data-node-id="19:633"
                data-name="Frame"
              >
                <Toggle className="h-[18px] relative shrink-0 w-[32px]" />
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
                  data-node-id="19:635"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Unread only
                </p>
              </div>
            </div>
          </div>
          <div
            className="content-stretch flex gap-[12px] items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:636"
            data-name="Field/Order"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-[76px]"
              data-node-id="19:637"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Order
            </p>
            <div
              className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-strong)] border-solid content-stretch flex gap-[8px] h-[30px] items-center overflow-clip px-[10px] relative rounded-[8px] shrink-0 w-[180px]"
              data-node-id="19:638"
              data-name="Select/Newest first"
            >
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
                data-node-id="19:639"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Newest first
              </p>
              <div
                className="flex-[1_0_0] h-px min-w-px relative"
                data-node-id="19:640"
                data-name="Spacer"
              />
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:641"
                data-name="Icon/chevron-down"
              >
                <img alt="" className="figma-asset" src={imgIconChevronDown1} />
              </div>
            </div>
          </div>
          <div
            className="bg-[var(--brew-bg-subtle)] content-stretch flex flex-col gap-[10px] items-start overflow-clip p-[12px] relative rounded-[8px] shrink-0 w-full"
            data-node-id="19:642"
            data-name="Filter (rules as a sentence)"
          >
            <div
              className="content-center flex flex-wrap gap-[6px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:643"
              data-name="Frame"
            >
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
                data-node-id="19:644"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Only items where
              </p>
              <div
                className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[4px] h-[24px] items-center overflow-clip px-[8px] relative rounded-[6px] shrink-0"
                data-node-id="19:645"
                data-name="Token/title"
              >
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                  data-node-id="19:646"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  title
                </p>
                <div
                  className="relative shrink-0 size-[11px]"
                  data-node-id="19:647"
                  data-name="Icon/chevron-down"
                >
                  <img alt="" className="figma-asset" src={imgIconChevronDown2} />
                </div>
              </div>
              <div
                className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[4px] h-[24px] items-center overflow-clip px-[8px] relative rounded-[6px] shrink-0"
                data-node-id="19:648"
                data-name="Token/contains"
              >
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                  data-node-id="19:649"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  contains
                </p>
                <div
                  className="relative shrink-0 size-[11px]"
                  data-node-id="19:650"
                  data-name="Icon/chevron-down"
                >
                  <img alt="" className="figma-asset" src={imgIconChevronDown2} />
                </div>
              </div>
              <div
                className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[4px] h-[24px] items-center overflow-clip px-[8px] relative rounded-[6px] shrink-0"
                data-node-id="19:651"
                data-name="Token/“figma”"
              >
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                  data-node-id="19:652"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  “figma”
                </p>
                <div
                  className="relative shrink-0 size-[11px]"
                  data-node-id="19:653"
                  data-name="Icon/chevron-down"
                >
                  <img alt="" className="figma-asset" src={imgIconChevronDown2} />
                </div>
              </div>
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
                data-node-id="19:654"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                or
              </p>
              <div
                className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[4px] h-[24px] items-center overflow-clip px-[8px] relative rounded-[6px] shrink-0"
                data-node-id="19:655"
                data-name="Token/author"
              >
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                  data-node-id="19:656"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  author
                </p>
                <div
                  className="relative shrink-0 size-[11px]"
                  data-node-id="19:657"
                  data-name="Icon/chevron-down"
                >
                  <img alt="" className="figma-asset" src={imgIconChevronDown2} />
                </div>
              </div>
              <div
                className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[4px] h-[24px] items-center overflow-clip px-[8px] relative rounded-[6px] shrink-0"
                data-node-id="19:658"
                data-name="Token/is"
              >
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                  data-node-id="19:659"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  is
                </p>
                <div
                  className="relative shrink-0 size-[11px]"
                  data-node-id="19:660"
                  data-name="Icon/chevron-down"
                >
                  <img alt="" className="figma-asset" src={imgIconChevronDown2} />
                </div>
              </div>
              <div
                className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[4px] h-[24px] items-center overflow-clip px-[8px] relative rounded-[6px] shrink-0"
                data-node-id="19:661"
                data-name="Token/Jo Park"
              >
                <p
                  className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                  data-node-id="19:662"
                  style={{ fontVariationSettings: '"wdth" 100' }}
                >
                  Jo Park
                </p>
                <div
                  className="relative shrink-0 size-[11px]"
                  data-node-id="19:663"
                  data-name="Icon/chevron-down"
                >
                  <img alt="" className="figma-asset" src={imgIconChevronDown2} />
                </div>
              </div>
            </div>
            <div
              className="content-stretch flex gap-[6px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:664"
              data-name="Frame"
            >
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
                data-node-id="19:665"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                + Condition
              </p>
              <div
                className="flex-[1_0_0] h-px min-w-px relative"
                data-node-id="19:666"
                data-name="Spacer"
              />
              <p
                className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
                data-node-id="19:667"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Matches 4 of 11 unread now
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

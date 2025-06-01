const clients = [
  {
    name: 'DA',
    width: 111,
    height: 34,
    src: 'https://cdn.prod.website-files.com/65b974ac4b4c61dbc8433e20/65bebed4490e95c8dbb26311_DA_Logo_w.svg',
    heightClass: 'h-6',
  },
  {
    name: 'Speak AI',
    width: 135,
    height: 33,
    src: '/logos/speak-ai.svg',
    heightClass: 'h-6',
  },
  {
    name: 'xAI',
    width: 25,
    height: 26,
    src: '/logos/x-ai.svg',
    heightClass: 'h-6',
  },
  {
    name: 'Character AI',
    width: 131,
    height: 18,
    src: '/logos/character-ai.svg',
    heightClass: 'h-4',
  },
  {
    name: 'Hello Patient',
    width: 476,
    height: 84,
    src: '/logos/hello-patient.svg',
    heightClass: 'h-[1.4rem]',
  },
];
export function Clients() {
  return (
    <div className="w-full border-b lg:border-t">
      <div className="align-center grid grid-cols-2 items-center overflow-hidden lg:mx-auto lg:max-w-7xl lg:grid-cols-6">
        <div className="flex h-16 items-center justify-center border-t border-r lg:border-t-0 lg:border-l">
          <div
            className="px-4 text-center text-sm font-semibold text-balance lg:text-left"
            style={{ opacity: 1 }}
          >
            Powering billions of calls in production for:
          </div>
        </div>
        {clients.map((client) => (
          <div
            key={client.name}
            className="relative h-16 items-center justify-center overflow-hidden border-t odd:border-r lg:border-t-0 lg:border-r"
          >
            <div
              className="absolute flex h-full w-full items-center justify-center"
              style={{
                transformOrigin: '50% 100%',
                opacity: 1,
                transform: 'translateY(0%)',
              }}
            >
              <img
                alt={client.name}
                loading="lazy"
                width={client.width}
                height={client.height}
                decoding="async"
                data-nimg="1"
                className={`w-auto ${client.heightClass}`}
                src={client.src}
                style={{ color: 'transparent' }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

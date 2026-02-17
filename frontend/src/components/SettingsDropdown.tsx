import { useState, useRef, useEffect } from 'react';
import { Settings, Check, Globe } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import type { Language } from '@/translations';
import { cn } from '@/utils';

interface SettingsDropdownProps {
  className?: string;
}

const languages: { code: Language; labelKey: 'settings.english' | 'settings.spanish' }[] = [
  { code: 'en', labelKey: 'settings.english' },
  { code: 'es', labelKey: 'settings.spanish' },
];

export function SettingsDropdown({ className }: SettingsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { t, language, setLanguage } = useTranslation();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLanguageSelect = (lang: Language) => {
    setLanguage(lang);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        title={t('nav.settings')}
        aria-label={t('nav.settings')}
      >
        <Settings className="h-5 w-5" aria-hidden="true" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-500 uppercase">
              <Globe className="h-3.5 w-3.5" />
              {t('settings.language')}
            </div>
          </div>

          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageSelect(lang.code)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2 text-sm transition-colors text-left',
                language === lang.code
                  ? 'bg-primary-50 text-primary-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              )}
            >
              <span>{t(lang.labelKey)}</span>
              {language === lang.code && (
                <Check className="h-4 w-4 text-primary-600" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

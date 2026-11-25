# -*- coding: utf-8 -*-
"""Documento de investigación/decisión: Integraciones fiscales de retenciones (SIRE/SICORE/SIRCAR)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Retenciones-Integraciones-Fiscales-SIRE-SICORE-SIRCAR.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=10.5, textColor=SLATE, spaceAfter=10, leading=14)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=G700, spaceBefore=12, spaceAfter=6, leading=16)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_cell  = S("cell", fontName="Helvetica", fontSize=9, textColor=colors.HexColor("#1f2937"), leading=12)
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9, textColor=G900, leading=12)
st_small = S("sm", fontName="Helvetica", fontSize=8, textColor=SLATE, leading=11)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Informe técnico")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazon del negocio agricola")
    canvas.drawRightString(w-15*mm, 10*mm, "Pagina %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Retenciones: integraciones y presentación fiscal", st_title))
    E.append(Paragraph("SIRE · SICORE · SIRCAR — qué son, cómo se presentan y qué resuelve AgroCore (Prioridad 4)", st_sub))

    E.append(Paragraph(
        "Este informe resume la <b>investigación</b> sobre los sistemas oficiales de retenciones y percepciones "
        "de Argentina y explica <b>qué hace AgroCore hoy</b>, qué es responsabilidad del <b>aplicativo/contador</b> y "
        "por qué no corresponde una integración automática total. La normativa cambia seguido: estos datos deben "
        "revisarse contra ARCA y tu contador antes de cada presentación.", st_intro))

    E.append(callout("<b>Conclusión principal:</b> estos sistemas <b>no tienen una API pública</b> para conectar el software "
                     "directamente. Se operan con <b>Clave Fiscal</b> en la web de ARCA / provincias, cargando los datos a mano "
                     "o subiendo un <b>archivo plano por lote</b>. Por eso AgroCore <b>prepara los datos y los archivos</b>, "
                     "pero la presentación final la hace la persona en el portal oficial.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("Los sistemas, en criollo", st_h2))
    data = [
        [Paragraph("Sistema", st_cellb), Paragraph("Para qué", st_cellb), Paragraph("Impuestos", st_cellb)],
        [Paragraph("SIRE", st_cell), Paragraph("Sistema Integral de Retenciones Electrónicas. Es el sistema nuevo de ARCA que reemplaza gradualmente al SICORE. Genera los certificados y recibe las DDJJ.", st_cell), Paragraph("Ganancias (F.2003), Seg. Social/SUSS (F.2004), IVA (F.2005)", st_cell)],
        [Paragraph("SICORE", st_cell), Paragraph("El sistema histórico de control de retenciones. Sigue vigente para los regímenes que todavía no migraron al SIRE (hoy conviven).", st_cell), Paragraph("Principalmente Ganancias (según migración)", st_cell)],
        [Paragraph("SIRCAR", st_cell), Paragraph("Sistema provincial (Convenio Multilateral) para las retenciones/percepciones de Ingresos Brutos de las provincias.", st_cell), Paragraph("IIBB (por jurisdicción)", st_cell)],
    ]
    t = Table(data, colWidths=[24*mm, 100*mm, 41*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100), ("BOX",(0,0),(-1,-1),0.6,G600), ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("VALIGN",(0,0),(-1,-1),"TOP"), ("LEFTPADDING",(0,0),(-1,-1),6), ("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    E.append(t)
    E.append(Spacer(1, 2))
    E.append(callout("<b>Importante (migración):</b> ARCA fue pasando regímenes del SICORE al SIRE <b>de a poco</b>. "
                     "Según el tipo de retención, hoy puede corresponder uno u otro sistema. <b>Verificá con tu contador</b> "
                     "qué régimen aplica a cada caso.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("Qué resuelve AgroCore hoy", st_h2))
    E.append(bullets([
        "<b>Carga de la retención en el momento</b> del pago (practicadas) y del cobro (sufridas), sin romper la cuenta corriente ni el banco.",
        "<b>Catálogo de regímenes</b> editable (alícuotas, mínimos, base, código, sistema) y <b>datos fiscales</b> de cada cliente/proveedor (condición, certificados de exclusión).",
        "<b>Liquidación de las practicadas</b>: panel de lo que falta ingresar al fisco y registro del depósito (mueve banco/caja, baja el pasivo).",
        "<b>Créditos fiscales de las sufridas</b>: saldo pendiente y aplicación a las DDJJ.",
        "<b>Estado del certificado</b> (pendiente, emitido, verificado, informado, anulado).",
        "<b>Archivos para presentar</b>: genera el .txt para <b>SICORE/SIRE</b> (nacionales) y <b>SIRCAR</b> (IIBB), filtrando por período, y marca las retenciones como <b>informadas</b> al generarlo.",
        "<b>Excel para el contador</b>: planilla con todas las retenciones y percepciones del período (practicadas y sufridas) para cargar o conciliar.",
    ]))

    E.append(Paragraph("Qué queda en manos del portal oficial / contador", st_h2))
    E.append(bullets([
        "La <b>presentación y el pago</b> finales se hacen con Clave Fiscal en ARCA / el portal provincial (no hay conexión automática).",
        "El <b>diseño de registro exacto</b> (anchos de campo y códigos de régimen) de cada aplicativo cambia por impuesto y en el tiempo. Por eso los .txt de AgroCore salen marcados como <b>PROVISORIO</b>: conviene validarlos contra un archivo real de tu contador antes de la primera presentación.",
        "La <b>emisión del certificado oficial</b> se hace en el SIRE (formularios F.2003 / F.2004 / F.2005). AgroCore registra el número y el estado, pero no emite el documento oficial.",
    ]))

    E.append(callout("<b>Recomendación de uso:</b> generá el <b>Excel por período</b> y pasáselo a tu contador para que cargue por "
                     "lote o concilie; usá los <b>.txt</b> como borrador y validalos una vez contra el aplicativo. Cuando tengamos "
                     "un archivo oficial de ejemplo de tu contador, afinamos el layout exacto y dejamos de marcarlo como provisorio.",
                     G100, G600, G900))

    E.append(Paragraph("Fuentes consultadas", st_h2))
    E.append(Paragraph("ARCA — Manual SIRE (afip.gob.ar/sire) · ARCA — Generación de certificados de retención/percepción · "
                       "ARCA — Consultas frecuentes (SIRE/SICORE) · Notas técnicas de software contable sobre la convivencia "
                       "SIRE/SICORE y SIRCAR. Datos a verificar contra la normativa vigente de ARCA y el contador.", st_small))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()

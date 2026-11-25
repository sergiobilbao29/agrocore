# -*- coding: utf-8 -*-
"""Instructivo UNIFICADO: Manejo integral de la hacienda (AgroCore).
Reemplaza a 'Circuito de Rodeos', 'Manejo de Animales' y 'Costo por Kg de carne'.
Cubre todo el ciclo: preparar el alimento (campana forrajera / mezcla), armar el
rodeo (campo/lote/corral), alimentacion con descuento de stock, gastos, compras y
ventas desde el evento, guias DT-e, liquidaciones de animales y la lectura de
costos por kg y ganancia (tablero, mapa y Ganaderia 360)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTR = os.path.join(BASE, "Instructivos")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=22, textColor=G900, spaceAfter=2, leading=26)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600,
        leftIndent=16, bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600,
        leftIndent=16, bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def _hf(titulo):
    def header_footer(canvas, doc):
        canvas.saveState(); w, h = A4
        canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
        try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
        except Exception: pass
        canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13)
        canvas.drawString(34*mm, h-15*mm, "AgroCore")
        canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, titulo)
        canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
        canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
        canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
        canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
        canvas.restoreState()
    return header_footer

def _doc(path, titulo):
    doc = BaseDocTemplate(path, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=_hf(titulo))])
    return doc

def build():
    OUT = os.path.join(INSTR, "Instructivo-Manejo-Integral-Hacienda.pdf")
    doc = _doc(OUT, "Manejo integral de hacienda")
    E = []
    E.append(Paragraph("Manejo integral de la hacienda", st_title))
    E.append(Paragraph("De la pastura al kilo vendido: rodeos, alimentación, gastos, compras/ventas, guías, liquidaciones y costo por kg", st_sub))
    E.append(Paragraph(
        "Esta guía junta en un solo lugar <b>todo el circuito ganadero</b> de AgroCore. Cada paso se "
        "carga una sola vez y alimenta a los demás: lo que gastás en alimento, sanidad y labores baja el "
        "<b>stock</b> y sube al <b>costo del rodeo</b>; las compras y ventas generan la <b>factura</b> y su "
        "<b>cuenta corriente</b>; las guías mueven la <b>hacienda</b> y las liquidaciones cierran la parte "
        "fiscal. Al final ves el <b>costo por kilo de carne</b> y la <b>ganancia</b> de cada lote, sin planillas aparte.", st_intro))
    E.append(callout("<b>El mapa del circuito:</b> Campaña forrajera / Mezcla &rarr; Rodeo (campo/lote/corral) &rarr; "
                     "Stock de hacienda (por campo y por lote/potrero: nacimientos, compras, ventas, muertes, traslados, "
                     "recategorizaciones) &rarr; Alimentación (descuenta stock) + Sanidad + Labores &rarr; Compras/Ventas + "
                     "Guías + Liquidaciones &rarr; Costo por kg y margen (Tablero, Mapa y Ganadería 360).", G100, G600, G900))
    E.append(callout("<b>Dos miradas de la hacienda, complementarias:</b> <b>Movimientos de animales</b> lleva el "
                     "<b>stock de existencias</b> por campo y por lote/potrero (cuántas cabezas de cada categoría hay y "
                     "dónde están, declarado SENASA vs real). <b>Rodeos y Hacienda</b> lleva el <b>costo</b> de cada lote "
                     "de producción (lo que comió, gastó y produjo en kilos). Conviene cargar las dos, pero podés arrancar "
                     "por la que más te sirva.", BLUE_BG, BLUE_BD, BLUE_TX))

    # 1) Preparar el alimento
    E.append(Paragraph("1) Preparar el alimento: pastura y raciones", st_h2))
    E.append(Paragraph("Antes de dar de comer conviene tener cargado <b>de dónde sale</b> el alimento, "
        "para que después descuente stock y sume costo al rodeo.", st_intro))
    E.append(Paragraph("a) Campaña forrajera (pastura, verdeos, rollos)", st_h3))
    E.append(steps([
        "Entrá a <b>Campañas</b> y creá una de tipo <b>Forrajera</b> (multicorte): centeno, alfalfa, avena, pradera, etc.",
        "Cargá sus <b>insumos y labores</b> (semilla, fertilizante, siembra, pulverizada). Eso arma el <b>costo de la pastura</b>.",
        "Si hacés rollos o fardos, registrá los <b>cortes</b> con los kilos/rollos obtenidos.",
    ]))
    E.append(Paragraph("b) Alimento preparado (producto mezcla / ración)", st_h3))
    E.append(steps([
        "En <b>Catálogos &rarr; Productos</b> creá un producto de tipo <b>Mezcla</b> (por ejemplo \"Ración engorde\").",
        "Cargale los <b>componentes</b> (maíz, expeller, núcleo...) con su proporción. Al usar la mezcla, el sistema "
        "<b>explota los componentes</b> y descuenta el stock de cada uno.",
    ]))
    E.append(callout("<b>Tip:</b> así tenés dos formas de alimentar cargadas: la <b>pastura</b> de la campaña forrajera "
                     "(se imputa por % al rodeo) y el <b>alimento de depósito</b> (grano suelto o mezcla).", BLUE_BG, BLUE_BD, BLUE_TX))

    # 2) Armar el rodeo
    E.append(Paragraph("2) Armar el rodeo (lote de engorde o cría)", st_h2))
    E.append(Paragraph("El <b>rodeo</b> es el lote de animales que vas a costear. En <b>Rodeos y Hacienda &rarr; + Nuevo lote</b>:", st_intro))
    E.append(steps([
        "Ponele <b>nombre</b> y elegí el <b>sistema</b> (engorde a campo, feedlot, cría, invernada, capitalización de terceros).",
        "Ubicalo en <b>Campo</b>, <b>Lote/potrero</b> y, para feedlot, el <b>Corral</b>.",
        "Elegí la <b>categoría</b> desde el <b>catálogo de animales</b> (Ternero, Novillito, Novillo, Vaca...). Se puede "
        "<b>cambiar</b> cuando recategorizan (ej. Ternero &rarr; Novillo).",
        "Cargá el <b>inventario inicial</b>: cabezas y kilos de arranque (o dejalo en 0 si vas a cargar la compra como evento).",
        "Opcional pero recomendado: cargá un <b>objetivo de $/kg y de GPD</b> para que el tablero te lo semaforice.",
    ]))
    E.append(callout("<b>Terceros (capitalización / hotelería):</b> si los animales son de un tercero, marcá el rodeo como "
                     "<b>externo</b> con su propietario. Se costean igual pero se muestran aparte y podés cobrar la "
                     "capitalización/hotelería.", AMBER_BG, AMBER_BD, AMBER_TX))

    # 3) Movimientos de animales (stock por campo y por lote)
    E.append(Paragraph("3) Movimientos de animales: stock por campo y por lote/potrero", st_h2))
    E.append(Paragraph("La pantalla <b>Movimientos de animales</b> (en <b>Ganadería y Haras</b>) lleva el <b>stock de "
        "existencias</b> de la hacienda. Para cada categoría muestra dos números: el <b>Declarado</b> (lo que figura en "
        "SENASA / ARCA) y el <b>Real</b> (el que arma el sistema sumando los movimientos). La <b>diferencia</b> entre "
        "ambos te avisa si hay algo sin registrar o un conteo distinto.", st_intro))
    E.append(callout("<b>Novedad (v2.314 / v2.315): hacienda por lote/potrero.</b> Además del stock por campo, ahora cada "
        "categoría se puede ubicar en un <b>lote o potrero</b>, y un mismo lote puede tener <b>varias categorías</b> "
        "conviviendo. En cada tarjeta de campo aparece abajo el <b>Detalle por lote/potrero</b> (cuántas cabezas de cada "
        "categoría hay en cada lote). Si no te interesa el detalle por lote, dejás el lote vacío y funciona por campo "
        "como siempre.", G100, G600, G900))

    E.append(Paragraph("a) Declarado vs real, y el peso para los kilos", st_h3))
    E.append(steps([
        "Con <b>+ Categoría</b> sumás una categoría al campo (desde el <b>catálogo de animales</b>, para no duplicar "
        "\"ternera/terneras\") y cargás el <b>declarado SENASA</b>.",
        "Con <b>Declarado / kg</b> editás las cabezas declaradas y el <b>peso promedio</b> por cabeza. Ese peso es el que "
        "convierte las cabezas en <b>kilos</b> (para el banco y la proyección).",
        "El <b>Real</b> no se escribe a mano: sale de los movimientos que cargues abajo. Para corregirlo, usás un "
        "<b>Ajuste / Conteo</b>.",
    ]))

    E.append(Paragraph("b) Tipos de movimiento (todas las variables)", st_h3))
    E.append(Paragraph("Con <b>+ Movimiento</b> elegís el <b>tipo</b>, la <b>fecha</b>, el <b>campo</b>, el "
        "<b>lote/potrero</b> (opcional), la <b>categoría</b> y la <b>cantidad</b> en cabezas (podés agregar kilos de "
        "balanza). Según el tipo, el sistema suma o resta al stock real:", st_intro))
    E.append(bullets([
        "<b>Nacimiento</b> (+): entran cabezas por parición. Suma al real.",
        "<b>Compra</b> (+): ingreso de animales comprados. Suma al real (la parte comercial se puede resolver con "
        "factura/guía, ver más abajo).",
        "<b>Muerte</b> (-): baja por mortandad. Resta al real.",
        "<b>Venta</b> (-): salida por venta. Resta al real y permite cargar <b>kilos, precio por kg, cliente</b> y "
        "<b>cobro</b> (cuenta corriente, efectivo o banco). Tiene dos modos: <b>Directo</b> (kilos de balanza ahora) o "
        "<b>A rendimiento</b> (se descuenta el stock ahora y los kilos/importe definitivos los cerrás después desde "
        "\"Ventas a rendimiento pendientes\").",
        "<b>Traslado</b>: mueve cabezas de un lugar a otro sin cambiar el total. Genera una <b>salida</b> en el origen y "
        "una <b>entrada</b> en el destino.",
        "<b>Cambio de categoría</b> (recategorización): baja en la categoría origen y alta en la destino, en el "
        "<b>mismo campo y lote</b> (ej. Ternero &rarr; Novillito). Respeta la <b>matriz</b> de transiciones del catálogo.",
        "<b>Ajuste / Conteo</b> (+/-): corrige el real contra un conteo físico. Es el único que admite cantidad "
        "<b>negativa</b> (ej. -2 si contaron dos menos).",
    ]))

    E.append(Paragraph("c) Traslado: entre campos y entre lotes (parcial)", st_h3))
    E.append(Paragraph("En el <b>Traslado</b> elegís el <b>campo y lote de origen</b> y el <b>campo y lote de destino</b>. "
        "Con eso cubrís los tres casos:", st_intro))
    E.append(bullets([
        "<b>De un campo a otro</b> (como siempre): elegís campo destino distinto.",
        "<b>De un lote a otro dentro del mismo campo</b>: dejás el mismo campo y cambiás el lote destino. Sirve para "
        "mover una tropa de un potrero a otro.",
        "<b>Una parte de la tropa</b>: cargás la cantidad que movas; el resto queda en el lote de origen. Así un lote "
        "puede ir repartiendo animales a varios potreros.",
    ]))
    E.append(callout("<b>No se puede</b> trasladar al <b>mismo</b> lugar (mismo campo y mismo lote): el destino tiene que "
        "ser otro campo u otro lote. Si trabajás sin lotes, el traslado sigue siendo de campo a campo como antes.",
        AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("d) Ver y corregir los movimientos", st_h3))
    E.append(bullets([
        "Abajo de todo está <b>Movimientos recientes</b> con <b>Fecha, Campo, Lote, Categoría, Tipo y Cantidad</b>. En "
        "los traslados, la columna Lote muestra <b>origen &rarr; destino</b>.",
        "Los movimientos simples (nacimiento, muerte, compra, ajuste) se pueden <b>editar</b> (lápiz) o <b>borrar</b>.",
        "Los <b>traslados</b>, <b>cambios de categoría</b> y <b>ventas</b> no se editan: se <b>borran y se vuelven a "
        "cargar</b>, así no se descuadran la plata ni las contrapartes.",
        "Arriba tenés filtros por <b>campo, categoría y diferencia</b>, el botón <b>Proyección</b> (estado y kilos "
        "estimados para el banco) y el acceso a <b>Categorías (Catálogo)</b>.",
    ]))
    E.append(callout("<b>Permisos:</b> el selector de lote se completa con los lotes del campo. Alcanza con permiso de "
        "<b>Stock: ver</b> (o Producción: ver) para que aparezcan; si una usuaria ganadera no los ve, revisá que el rol "
        "tenga alguno de esos permisos.", BLUE_BG, BLUE_BD, BLUE_TX))

    # 4) Alimentacion
    E.append(Paragraph("4) Alimentación (descuenta stock y suma costo)", st_h2))
    E.append(Paragraph("Dentro de la ficha del rodeo, con <b>+ Evento &rarr; Alimentación</b>:", st_intro))
    E.append(steps([
        "Elegí el <b>producto</b> (grano, mezcla/ración) y la <b>cantidad</b>.",
        "Elegí el <b>depósito</b> de donde sale: el sistema <b>descuenta ese stock</b> (si es mezcla, descuenta cada componente).",
        "El costo entra como <b>alimentación</b> del rodeo.",
    ]))
    E.append(Paragraph("Imputar la pastura de la campaña forrajera", st_h3))
    E.append(steps([
        "En la ficha del rodeo usá <b>Imputar pastura</b> y elegí la <b>campaña forrajera</b>.",
        "Indicá el <b>porcentaje</b> que consumió ese rodeo (por si la pastura la comparten varios).",
        "Suma al rodeo el costo proporcional de la pastura como alimentación.",
    ]))

    # 5) Gastos
    E.append(Paragraph("5) Gastos: sanidad, labores y otros", st_h2))
    E.append(bullets([
        "<b>Sanidad:</b> vacunas, antiparasitarios, sanidad general (puede descontar stock del depósito).",
        "<b>Labores:</b> jornales, servicios, fletes internos, gastos de manejo.",
        "<b>Otros:</b> cualquier costo directo que no entre en las categorías anteriores.",
    ]))
    E.append(Paragraph("Todos suman al <b>costo directo</b> del rodeo, que es lo que después divide los kilos producidos "
        "para darte el <b>$/kg producido</b>.", st_intro))

    # 6) Compras y ventas desde el evento
    E.append(Paragraph("6) Compras y ventas (con factura y cuenta corriente)", st_h2))
    E.append(Paragraph("Cuando el evento del rodeo es una <b>compra (ingreso)</b>, una <b>venta</b> o un gasto de "
        "<b>sanidad/otro</b> con proveedor, podés resolver la parte comercial <b>sin salir de la ficha</b>:", st_intro))
    E.append(steps([
        "Cargá el evento (cabezas, kilos, monto) y elegí el <b>cliente</b> o <b>proveedor</b>.",
        "Elegí cómo registrarlo: <b>Crear factura nueva</b> (tipo, punto de venta, número, IVA) &rarr; genera el comprobante "
        "y su <b>cuenta a pagar/cobrar</b>; <b>Vincular</b> una factura ya existente; o dejar solo la <b>cuenta corriente</b>.",
        "El evento queda ligado al comprobante, así el costo/venta y la deuda quedan en línea.",
    ]))
    E.append(callout("<b>Cliente que también es proveedor:</b> si a quien le vendés también te vende, podés <b>compensar</b> "
                     "las cuentas (netear lo que te debe contra lo que le debés) desde Compensación de cuentas.", BLUE_BG, BLUE_BD, BLUE_TX))

    # 7) Guias
    E.append(Paragraph("7) Guías de hacienda (DT-e)", st_h2))
    E.append(Paragraph("La <b>guía DT-e</b> es el documento que ampara el movimiento de los animales. En "
        "<b>Guías de hacienda (DT-e)</b>:", st_intro))
    E.append(steps([
        "Creá la guía (ingreso o egreso) con el <b>motivo</b> (compra, venta, faena, invernada, traslado).",
        "Cargá los <b>renglones</b> (categoría, cabezas, kilos, precio). Podés <b>importar</b> desde foto o PDF.",
        "Al guardar, <b>mueve el stock</b> de hacienda y deja una <b>cuenta corriente provisoria</b> (estimada) con el proveedor/cliente.",
        "Podés cargar <b>pagos a cuenta</b> de la guía mientras no llega el comprobante final.",
        "Cuando llega la <b>liquidación</b> o <b>factura</b> definitiva, <b>vinculá</b> la guía para cerrar la parte fiscal "
        "y reemplazar el estimado por el valor real.",
    ]))

    # 8) Liquidaciones
    E.append(Paragraph("8) Liquidaciones de animales", st_h2))
    E.append(Paragraph("La <b>liquidación</b> es la venta fiscal de la hacienda (del frigorífico o consignatario). En "
        "<b>Liquidaciones animales</b>:", st_intro))
    E.append(steps([
        "Importá el <b>PDF</b> de la liquidación (detecta categoría, cabezas, kilos y precio) o cargala a mano.",
        "El sistema descuenta el <b>stock real</b> (y ajusta el declarado SENASA), suma las <b>retenciones/gastos</b> "
        "y deja el <b>neto a cobrar</b> en la cuenta corriente del cliente.",
        "Marcá <b>Cobrado</b> cuando entra la plata (o seguí el saldo pendiente desde Ganadería 360).",
    ]))

    # 9) Costo por kg y ganancia
    E.append(Paragraph("9) Costo por kilo de carne y ganancia", st_h2))
    E.append(Paragraph("Con todo lo anterior cargado, AgroCore calcula solo los indicadores. Qué significa cada uno:", st_intro))
    E.append(bullets([
        "<b>Kg producidos:</b> (stock final + vendidos) - (stock inicial + comprados). Es la carne que generó el lote.",
        "<b>$/kg producido:</b> costos directos (alimentación + sanidad + labores + otros) / kg producidos. El costo de "
        "<b>hacer</b> el kilo.",
        "<b>$/kg terminado:</b> (compra + fletes + costos) / kg del animal. Lo que te <b>cuesta puesto</b> el kilo final.",
        "<b>GPD:</b> ganancia de peso por cabeza por día. Necesita que cargues <b>pesajes</b> para ser real.",
        "<b>Margen:</b> ventas - costo total. La <b>ganancia</b> del lote.",
    ]))
    E.append(callout("<b>Clave:</b> cargá <b>pesajes</b> cada tanto (a mano o desde balanza). Sin pesaje, el sistema estima "
                     "por inventario y no captura la ganancia de peso, así que el GPD y el $/kg quedan incompletos.", AMBER_BG, AMBER_BD, AMBER_TX))

    # 10) Ver todo junto
    E.append(Paragraph("10) Ver todo junto: tablero, mapa y Ganadería 360", st_h2))
    E.append(bullets([
        "<b>Rodeos y Hacienda &rarr; Tablero de eficiencia:</b> una tarjeta por lote con GPD, $/kg y margen, con "
        "<b>semáforo</b> contra el objetivo (verde dentro, rojo fuera).",
        "<b>Mapa de lotes (vista Hacienda):</b> cada potrero con su rodeo muestra una tarjeta con cabezas, peso "
        "promedio, kilos y carga (cab/ha); desde ahí podés <b>Mover</b> el rodeo o ver su ficha.",
        "<b>Ganadería 360:</b> el panel resumen del dueño: cabezas y kg totales, <b>$/kg promedio</b> ponderado, "
        "<b>margen total</b>, la plata invertida por rubro y el circuito comercial del período (ventas por liquidación "
        "y guías pendientes).",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    for q,a in [
        ("&#191;Por dónde empiezo?",
         "Cargá primero de qué vas a alimentar (campaña forrajera y/o mezcla), después creá el rodeo y arrancá a cargar "
         "eventos (alimentación, sanidad, compras/ventas). Los números se arman solos."),
        ("&#191;La alimentación descuenta el stock?",
         "Sí. Al cargar Alimentación elegís el depósito de origen y descuenta ese stock; si es una mezcla, descuenta "
         "cada componente."),
        ("&#191;Qué diferencia hay entre guía y liquidación?",
         "La <b>guía</b> mueve los animales y deja un estimado; la <b>liquidación</b> es la venta fiscal definitiva. "
         "Cuando llega la liquidación, vinculá la guía para cerrar."),
        ("&#191;Cómo se calcula la ganancia?",
         "Margen = ventas - costo total (compra + directos). Lo ves por lote en el tablero y global en Ganadería 360."),
        ("&#191;Y si los animales son de un tercero?",
         "Marcá el rodeo/ficha como externo. Se costean igual pero se muestran aparte y podés cobrar la capitalización "
         "u hotelería."),
        ("&#191;Cómo llevo el stock por lote o potrero?",
         "En Movimientos de animales, al cargar el movimiento elegí el Lote/potrero. Un mismo lote puede tener varias "
         "categorías juntas, y en la tarjeta del campo ves el Detalle por lote. Si dejás el lote vacío, funciona por "
         "campo como antes."),
        ("&#191;Cómo paso una parte de la tropa a otro potrero?",
         "Con un Traslado: elegí lote origen y lote destino (podés quedarte en el mismo campo) y cargá solo las cabezas "
         "que movas. El resto queda en el lote de origen."),
    ]:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E); print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
